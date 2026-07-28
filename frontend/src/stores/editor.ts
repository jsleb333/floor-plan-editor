import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import { ApiError } from '@/api/client'
import { getPlan, savePlanDocument, updatePlanMetadata } from '@/api/plans'
import type { PlanMetadataPatch } from '@/api/plans'
import type {
  Circuit,
  ControlLink,
  Device,
  Dimension,
  Guide,
  Joint,
  Label,
  Opening,
  Plan,
  PlanDocument,
  Stairs,
  Underlay,
  Viewport,
  Wall,
  Wire,
} from '@/types/plan'
import { pickNextCircuitColor } from '@/utils/circuits'
import {
  deriveJoints,
  resolveGuideLine,
  resolveGuideLines,
  resolveWallNetwork,
  solveConstraints,
  wallIdsOf,
  wallSegmentSpan,
} from '@/utils/geometry'
import type { GuideLine, ResolvedNetwork } from '@/utils/geometry'
import type { PresetListName } from '@/utils/presetLists'
import { DEFAULT_DISPLAY_PRECISION_IN } from '@/utils/units'

const AUTOSAVE_DEBOUNCE_MS = 2000
const HTTP_CONFLICT = 409
/** Practical undo history depth (spec E3: >= 100 steps). */
const HISTORY_LIMIT = 100
/** Guides store their angle in degrees; the resolved geometry reports directions. */
const RAD_TO_DEG = 180 / Math.PI

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/** The only way to change the plan document; grows one variant per mutating action. */
export type EditorCommand =
  | { type: 'setViewport'; viewport: Viewport }
  | { type: 'setActiveTool'; toolId: string }
  | { type: 'setThicknessPresets'; presetsIn: number[] }
  | { type: 'setDisplayPrecision'; precisionIn: number | null }
  | { type: 'setPresetList'; name: PresetListName; valuesIn: number[] }
  | { type: 'addWall'; wall: Wall; joints?: Joint[]; index?: number }
  | { type: 'addJoints'; joints: Joint[] }
  | { type: 'removeJoints'; jointIds: string[] }
  | { type: 'updateWall'; wallId: string; wall: Wall }
  | { type: 'removeWall'; wallId: string }
  | { type: 'addGuide'; guide: Guide; index?: number }
  | { type: 'updateGuide'; guideId: string; guide: Guide }
  | { type: 'removeGuide'; guideId: string }
  | { type: 'addOpening'; opening: Opening; index?: number }
  | { type: 'updateOpening'; openingId: string; opening: Opening }
  | { type: 'removeOpening'; openingId: string }
  | { type: 'addStairs'; stairs: Stairs; index?: number }
  | { type: 'updateStairs'; stairsId: string; stairs: Stairs }
  | { type: 'removeStairs'; stairsId: string }
  | { type: 'addLabel'; label: Label; index?: number }
  | { type: 'updateLabel'; labelId: string; label: Label }
  | { type: 'removeLabel'; labelId: string }
  | { type: 'addDimension'; dimension: Dimension; index?: number }
  | { type: 'updateDimension'; dimensionId: string; dimension: Dimension }
  | { type: 'removeDimension'; dimensionId: string }
  | { type: 'addDevice'; device: Device; index?: number }
  | { type: 'updateDevice'; deviceId: string; device: Device }
  | { type: 'removeDevice'; deviceId: string }
  | { type: 'addCircuit'; circuit: Circuit; index?: number }
  | { type: 'updateCircuit'; circuitId: string; circuit: Circuit }
  | { type: 'removeCircuit'; circuitId: string }
  | { type: 'addWire'; wire: Wire; index?: number }
  | { type: 'updateWire'; wireId: string; wire: Wire }
  | { type: 'removeWire'; wireId: string }
  | { type: 'addControlLink'; link: ControlLink; index?: number }
  | { type: 'removeControlLink'; linkId: string }
  | { type: 'setUnderlay'; underlay: Underlay | null }

/** Distance in inches a pasted/duplicated device is offset from its source (spec D3). */
export const PASTE_OFFSET_IN = 12

/** Kinds of selectable elements (spec E2). */
export type ElementKind =
  'wall' | 'opening' | 'stairs' | 'label' | 'dimension' | 'device' | 'wire' | 'guide' | 'underlay'

/** Selection id of the (single) underlay — the document holds at most one. */
export const UNDERLAY_ELEMENT_ID = 'underlay'

/** A reference to one selectable element on the canvas (spec E2). */
export interface ElementRef {
  kind: ElementKind
  id: string
}

/** How `select` combines new refs with the current selection. */
export type SelectionMode = 'replace' | 'add' | 'toggle'

/** Stable map key for a selection entry. */
export function selectionKeyOf(elementRef: ElementRef): string {
  return `${elementRef.kind}:${elementRef.id}`
}

/** One undo step: the forward commands and their inverses, in application order. */
interface HistoryEntry {
  commands: EditorCommand[]
  inverses: EditorCommand[]
}

function insertAt<T>(items: readonly T[], item: T, index: number | undefined): T[] {
  const next = [...items]
  next.splice(index ?? next.length, 0, item)
  return next
}

function replaceById<T extends { id: string }>(items: readonly T[], id: string, item: T): T[] {
  return items.map((existing) => (existing.id === id ? item : existing))
}

function removeById<T extends { id: string }>(items: readonly T[], id: string): T[] {
  return items.filter((existing) => existing.id !== id)
}

/** Whether a guide's geometry is derived from the given wall (spec S9). */
function guideAnchorsTo(guide: Guide, wallId: string): boolean {
  switch (guide.kind) {
    case 'surface':
      return guide.wall_id === wallId
    case 'point':
      return guide.anchor.wall_id === wallId
    case 'free':
      return false
  }
}

function applyCommand(document: PlanDocument, command: EditorCommand): PlanDocument {
  switch (command.type) {
    case 'setViewport':
      return {
        ...document,
        viewport: {
          center: { ...command.viewport.center },
          zoom: command.viewport.zoom,
        },
      }
    case 'setActiveTool':
      return { ...document, active_tool: command.toolId }
    case 'setThicknessPresets':
      return { ...document, thickness_presets_in: [...command.presetsIn] }
    case 'setDisplayPrecision':
      return { ...document, display_precision_in: command.precisionIn }
    case 'setPresetList':
      return {
        ...document,
        preset_lists: { ...document.preset_lists, [command.name]: [...command.valuesIn] },
      }
    case 'addWall':
      return {
        ...document,
        walls: insertAt(document.walls, command.wall, command.index),
        joints: [...document.joints, ...(command.joints ?? [])],
      }
    case 'updateWall':
      return { ...document, walls: replaceById(document.walls, command.wallId, command.wall) }
    case 'addJoints':
      return { ...document, joints: [...document.joints, ...command.joints] }
    case 'removeJoints': {
      const dropped = new Set(command.jointIds)
      return { ...document, joints: document.joints.filter((joint) => !dropped.has(joint.id)) }
    }
    case 'removeWall':
      // A joint naming a wall that is gone would resolve to nothing; dropping
      // them here keeps the graph a true description of the document.
      return {
        ...document,
        walls: removeById(document.walls, command.wallId),
        joints: document.joints.filter((joint) => !wallIdsOf(joint).includes(command.wallId)),
      }
    case 'addGuide':
      return { ...document, guides: insertAt(document.guides, command.guide, command.index) }
    case 'updateGuide':
      return { ...document, guides: replaceById(document.guides, command.guideId, command.guide) }
    case 'removeGuide':
      return { ...document, guides: removeById(document.guides, command.guideId) }
    case 'addOpening':
      return { ...document, openings: insertAt(document.openings, command.opening, command.index) }
    case 'updateOpening':
      return {
        ...document,
        openings: replaceById(document.openings, command.openingId, command.opening),
      }
    case 'removeOpening':
      return { ...document, openings: removeById(document.openings, command.openingId) }
    case 'addStairs':
      return { ...document, stairs: insertAt(document.stairs, command.stairs, command.index) }
    case 'updateStairs':
      return { ...document, stairs: replaceById(document.stairs, command.stairsId, command.stairs) }
    case 'removeStairs':
      return { ...document, stairs: removeById(document.stairs, command.stairsId) }
    case 'addLabel':
      return { ...document, labels: insertAt(document.labels, command.label, command.index) }
    case 'updateLabel':
      return { ...document, labels: replaceById(document.labels, command.labelId, command.label) }
    case 'removeLabel':
      return { ...document, labels: removeById(document.labels, command.labelId) }
    case 'addDimension':
      return {
        ...document,
        dimensions: insertAt(document.dimensions, command.dimension, command.index),
      }
    case 'updateDimension':
      return {
        ...document,
        dimensions: replaceById(document.dimensions, command.dimensionId, command.dimension),
      }
    case 'removeDimension':
      return { ...document, dimensions: removeById(document.dimensions, command.dimensionId) }
    case 'addDevice':
      return { ...document, devices: insertAt(document.devices, command.device, command.index) }
    case 'updateDevice':
      return {
        ...document,
        devices: replaceById(document.devices, command.deviceId, command.device),
      }
    case 'removeDevice':
      return { ...document, devices: removeById(document.devices, command.deviceId) }
    case 'addCircuit':
      return { ...document, circuits: insertAt(document.circuits, command.circuit, command.index) }
    case 'updateCircuit':
      return {
        ...document,
        circuits: replaceById(document.circuits, command.circuitId, command.circuit),
      }
    case 'removeCircuit':
      return { ...document, circuits: removeById(document.circuits, command.circuitId) }
    case 'addWire':
      return { ...document, wires: insertAt(document.wires, command.wire, command.index) }
    case 'updateWire':
      return { ...document, wires: replaceById(document.wires, command.wireId, command.wire) }
    case 'removeWire':
      return { ...document, wires: removeById(document.wires, command.wireId) }
    case 'addControlLink':
      return {
        ...document,
        control_links: insertAt(document.control_links, command.link, command.index),
      }
    case 'removeControlLink':
      return {
        ...document,
        control_links: removeById(document.control_links, command.linkId),
      }
    case 'setUnderlay':
      return { ...document, underlay: command.underlay }
  }
}

/**
 * Inverse of `command` against the document it is ABOUT to be applied to.
 * `null` marks a valid but non-undoable command (viewport, active-tool and
 * plan-settings changes save but never enter the history, spec E3/P4/§5.9);
 * `undefined` marks a no-op whose target is missing, which the caller must
 * skip entirely.
 */
function invertCommand(
  document: PlanDocument,
  command: EditorCommand,
): EditorCommand | null | undefined {
  switch (command.type) {
    case 'setViewport':
      return null
    case 'setActiveTool':
      return null
    case 'setThicknessPresets':
      return null
    case 'setDisplayPrecision':
      return null
    case 'setPresetList':
      return null
    case 'addWall':
      return { type: 'removeWall', wallId: command.wall.id }
    case 'addJoints':
      return { type: 'removeJoints', jointIds: command.joints.map((joint) => joint.id) }
    case 'removeJoints': {
      const dropped = new Set(command.jointIds)
      return { type: 'addJoints', joints: document.joints.filter((joint) => dropped.has(joint.id)) }
    }
    case 'updateWall': {
      const previous = document.walls.find((wall) => wall.id === command.wallId)
      if (!previous) return undefined
      return { type: 'updateWall', wallId: command.wallId, wall: previous }
    }
    case 'removeWall': {
      const index = document.walls.findIndex((wall) => wall.id === command.wallId)
      if (index === -1) return undefined
      return {
        type: 'addWall',
        wall: document.walls[index],
        joints: document.joints.filter((joint) => wallIdsOf(joint).includes(command.wallId)),
        index,
      }
    }
    case 'addGuide':
      return { type: 'removeGuide', guideId: command.guide.id }
    case 'updateGuide': {
      const previous = document.guides.find((guide) => guide.id === command.guideId)
      if (!previous) return undefined
      return { type: 'updateGuide', guideId: command.guideId, guide: previous }
    }
    case 'removeGuide': {
      const index = document.guides.findIndex((guide) => guide.id === command.guideId)
      if (index === -1) return undefined
      return { type: 'addGuide', guide: document.guides[index], index }
    }
    case 'addOpening':
      return { type: 'removeOpening', openingId: command.opening.id }
    case 'updateOpening': {
      const previous = document.openings.find((opening) => opening.id === command.openingId)
      if (!previous) return undefined
      return { type: 'updateOpening', openingId: command.openingId, opening: previous }
    }
    case 'removeOpening': {
      const index = document.openings.findIndex((opening) => opening.id === command.openingId)
      if (index === -1) return undefined
      return { type: 'addOpening', opening: document.openings[index], index }
    }
    case 'addStairs':
      return { type: 'removeStairs', stairsId: command.stairs.id }
    case 'updateStairs': {
      const previous = document.stairs.find((stairs) => stairs.id === command.stairsId)
      if (!previous) return undefined
      return { type: 'updateStairs', stairsId: command.stairsId, stairs: previous }
    }
    case 'removeStairs': {
      const index = document.stairs.findIndex((stairs) => stairs.id === command.stairsId)
      if (index === -1) return undefined
      return { type: 'addStairs', stairs: document.stairs[index], index }
    }
    case 'addLabel':
      return { type: 'removeLabel', labelId: command.label.id }
    case 'updateLabel': {
      const previous = document.labels.find((label) => label.id === command.labelId)
      if (!previous) return undefined
      return { type: 'updateLabel', labelId: command.labelId, label: previous }
    }
    case 'removeLabel': {
      const index = document.labels.findIndex((label) => label.id === command.labelId)
      if (index === -1) return undefined
      return { type: 'addLabel', label: document.labels[index], index }
    }
    case 'addDimension':
      return { type: 'removeDimension', dimensionId: command.dimension.id }
    case 'updateDimension': {
      const previous = document.dimensions.find((dimension) => dimension.id === command.dimensionId)
      if (!previous) return undefined
      return { type: 'updateDimension', dimensionId: command.dimensionId, dimension: previous }
    }
    case 'removeDimension': {
      const index = document.dimensions.findIndex(
        (dimension) => dimension.id === command.dimensionId,
      )
      if (index === -1) return undefined
      return { type: 'addDimension', dimension: document.dimensions[index], index }
    }
    case 'addDevice':
      return { type: 'removeDevice', deviceId: command.device.id }
    case 'updateDevice': {
      const previous = document.devices.find((device) => device.id === command.deviceId)
      if (!previous) return undefined
      return { type: 'updateDevice', deviceId: command.deviceId, device: previous }
    }
    case 'removeDevice': {
      const index = document.devices.findIndex((device) => device.id === command.deviceId)
      if (index === -1) return undefined
      return { type: 'addDevice', device: document.devices[index], index }
    }
    case 'addCircuit':
      return { type: 'removeCircuit', circuitId: command.circuit.id }
    case 'updateCircuit': {
      const previous = document.circuits.find((circuit) => circuit.id === command.circuitId)
      if (!previous) return undefined
      return { type: 'updateCircuit', circuitId: command.circuitId, circuit: previous }
    }
    case 'removeCircuit': {
      const index = document.circuits.findIndex((circuit) => circuit.id === command.circuitId)
      if (index === -1) return undefined
      return { type: 'addCircuit', circuit: document.circuits[index], index }
    }
    case 'addWire':
      return { type: 'removeWire', wireId: command.wire.id }
    case 'updateWire': {
      const previous = document.wires.find((wire) => wire.id === command.wireId)
      if (!previous) return undefined
      return { type: 'updateWire', wireId: command.wireId, wire: previous }
    }
    case 'removeWire': {
      const index = document.wires.findIndex((wire) => wire.id === command.wireId)
      if (index === -1) return undefined
      return { type: 'addWire', wire: document.wires[index], index }
    }
    case 'addControlLink':
      return { type: 'removeControlLink', linkId: command.link.id }
    case 'removeControlLink': {
      const index = document.control_links.findIndex((link) => link.id === command.linkId)
      if (index === -1) return undefined
      return { type: 'addControlLink', link: document.control_links[index], index }
    }
    case 'setUnderlay':
      return { type: 'setUnderlay', underlay: document.underlay }
  }
}

/**
 * Coalescing key for update commands inside a transaction: repeated updates of
 * the same element during a drag collapse to the latest one.
 */
function updateKeyOf(command: EditorCommand): string | null {
  switch (command.type) {
    case 'updateWall':
      return `wall:${command.wallId}`
    case 'updateGuide':
      return `guide:${command.guideId}`
    case 'updateOpening':
      return `opening:${command.openingId}`
    case 'updateStairs':
      return `stairs:${command.stairsId}`
    case 'updateLabel':
      return `label:${command.labelId}`
    case 'updateDimension':
      return `dimension:${command.dimensionId}`
    case 'updateDevice':
      return `device:${command.deviceId}`
    case 'updateCircuit':
      return `circuit:${command.circuitId}`
    case 'updateWire':
      return `wire:${command.wireId}`
    case 'setUnderlay':
      return 'underlay'
    default:
      return null
  }
}

/**
 * Editor session state: the open plan, its document, the undo/redo history,
 * the element selection and the autosave loop.
 *
 * All document changes go through `mutate(command)`; every mutation computes
 * its inverse at apply time and lands on the undo stack (viewport changes are
 * applied and saved but excluded). `beginTransaction`/`commitTransaction`
 * coalesce a drag's mutations into one undo step; `abortTransaction` reverts
 * them. Every mutation — including undo/redo — schedules a debounced PUT of
 * the full document with the current revision (optimistic concurrency). A 409
 * conflict reloads the server's version and surfaces an error state.
 */
export const useEditorStore = defineStore('editor', () => {
  const plan = shallowRef<Plan | null>(null)
  // REQUIREMENTS §10.1 reactivity discipline: the document grows to thousands of
  // geometry nodes in later milestones, and deep-proxying every point would wreck
  // the 60 fps interaction target. So the document lives in a shallowRef, is only
  // ever swapped wholesale by mutate(), and documentVersion is bumped explicitly
  // as the one cheap signal consumers can watch.
  const document = shallowRef<PlanDocument | null>(null)
  const documentVersion = ref(0)
  const revision = ref(0)
  const saveState = ref<SaveState>('idle')
  const saveError = ref<string | null>(null)
  const canUndo = ref(false)
  const canRedo = ref(false)
  const selection = shallowRef<ReadonlyMap<string, ElementRef>>(new Map())
  // Session-level device clipboard (spec D3); not persisted.
  const deviceClipboard = shallowRef<Device[]>([])
  // The circuit new wires are created on and the Circuits panel row highlights
  // (spec W1/C5); session-level, never persisted.
  const activeCircuitId = ref<string | null>(null)
  // The isolated circuit: its wires and connected devices render full colour,
  // everything else dims (spec C5). `null` = no isolation.
  const isolatedCircuitId = ref<string | null>(null)

  let undoStack: HistoryEntry[] = []
  let redoStack: HistoryEntry[] = []
  let transaction: HistoryEntry | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let saving = false
  let dirtyDuringSave = false

  function selectedIdsOfKind(kind: ElementKind): ReadonlySet<string> {
    const ids = new Set<string>()
    for (const entry of selection.value.values()) {
      if (entry.kind === kind) ids.add(entry.id)
    }
    return ids
  }

  /**
   * The resolved wall network (`docs/WALL_NETWORK.md`): the one derived geometry
   * the renderer, snapping, export and hit-testing all read, memoized on
   * `documentVersion` so a document change resolves it once for everybody.
   */
  const wallNetwork = computed<ResolvedNetwork>(() => {
    void documentVersion.value
    return resolveWallNetwork(document.value?.walls ?? [], document.value?.joints ?? [])
  })

  /**
   * Every guide resolved to its world line (spec S9), memoized on
   * `documentVersion` like `wallNetwork` — the one place the renderer, the tape
   * measure tool and the snap engine read guide geometry from.
   */
  const guideLines = computed<GuideLine[]>(() => {
    void documentVersion.value
    return resolveGuideLines(
      document.value?.guides ?? [],
      document.value?.walls ?? [],
      wallNetwork.value,
    )
  })

  const selectedWallIds = computed<ReadonlySet<string>>(() => selectedIdsOfKind('wall'))
  const selectedOpeningIds = computed<ReadonlySet<string>>(() => selectedIdsOfKind('opening'))
  const selectedStairsIds = computed<ReadonlySet<string>>(() => selectedIdsOfKind('stairs'))
  const selectedLabelIds = computed<ReadonlySet<string>>(() => selectedIdsOfKind('label'))
  const selectedDimensionIds = computed<ReadonlySet<string>>(() => selectedIdsOfKind('dimension'))
  const selectedDeviceIds = computed<ReadonlySet<string>>(() => selectedIdsOfKind('device'))
  const selectedWireIds = computed<ReadonlySet<string>>(() => selectedIdsOfKind('wire'))
  const selectedGuideIds = computed<ReadonlySet<string>>(() => selectedIdsOfKind('guide'))

  function selectedOfCollection<T extends { id: string }>(
    items: readonly T[] | undefined,
    ids: ReadonlySet<string>,
  ): T[] {
    return (items ?? []).filter((item) => ids.has(item.id))
  }

  const selectedWalls = computed<Wall[]>(() => {
    void documentVersion.value
    return selectedOfCollection(document.value?.walls, selectedWallIds.value)
  })

  const selectedOpenings = computed<Opening[]>(() => {
    void documentVersion.value
    return selectedOfCollection(document.value?.openings, selectedOpeningIds.value)
  })

  const selectedStairs = computed<Stairs[]>(() => {
    void documentVersion.value
    return selectedOfCollection(document.value?.stairs, selectedStairsIds.value)
  })

  const selectedLabels = computed<Label[]>(() => {
    void documentVersion.value
    return selectedOfCollection(document.value?.labels, selectedLabelIds.value)
  })

  const selectedDimensions = computed<Dimension[]>(() => {
    void documentVersion.value
    return selectedOfCollection(document.value?.dimensions, selectedDimensionIds.value)
  })

  const selectedDevices = computed<Device[]>(() => {
    void documentVersion.value
    return selectedOfCollection(document.value?.devices, selectedDeviceIds.value)
  })

  const selectedWires = computed<Wire[]>(() => {
    void documentVersion.value
    return selectedOfCollection(document.value?.wires, selectedWireIds.value)
  })

  const selectedGuides = computed<Guide[]>(() => {
    void documentVersion.value
    return selectedOfCollection(document.value?.guides, selectedGuideIds.value)
  })

  const selectedUnderlay = computed<Underlay | null>(() => {
    void documentVersion.value
    const key = selectionKeyOf({ kind: 'underlay', id: UNDERLAY_ELEMENT_ID })
    return selection.value.has(key) ? (document.value?.underlay ?? null) : null
  })

  /**
   * Effective display precision in inches (spec §5.9 tier 2): the plan's
   * `display_precision_in` override when set, else the 1/8" default. The one
   * reactive source every feet-inches label in the editor formats against.
   */
  const displayPrecisionIn = computed<number>(
    () => document.value?.display_precision_in ?? DEFAULT_DISPLAY_PRECISION_IN,
  )

  /**
   * Rebuilds wall connectivity when a document arrives without it — a v7 plan
   * migrated forward, an imported file, or anything hand-edited. Derived from
   * geometry, so it is a repair rather than a guess, and it runs outside the
   * history: nothing the user did is being undone (`docs/WALL_NETWORK.md` §9).
   */
  function healJoints(loaded: PlanDocument): PlanDocument {
    if (loaded.joints.length > 0 || loaded.walls.length === 0) return loaded
    const joints = deriveJoints(loaded.walls)
    // Derived relations are not enough on their own: a pre-v8 document stored T
    // endpoints on the HOST's spine, half a thickness past where the wall really
    // ends. Solving once makes the stored geometry honest, which is what every
    // parametric address on those walls depends on.
    const solution = solveConstraints(
      loaded.walls,
      joints,
      loaded.walls.map((wall) => wall.id),
    )
    const walls = loaded.walls.map((wall) => solution.moved.get(wall.id) ?? wall)
    return { ...loaded, walls, joints }
  }

  function adoptPlan(loaded: Plan): void {
    plan.value = loaded
    document.value = healJoints(loaded.document)
    documentVersion.value += 1
    revision.value = loaded.revision
    undoStack = []
    redoStack = []
    transaction = null
    syncHistoryFlags()
    selection.value = new Map()
    activeCircuitId.value = loaded.document.circuits?.[0]?.id ?? null
    isolatedCircuitId.value = null
  }

  /** The next distinguishable circuit colour, skipping ones already in use (spec C2). */
  function nextCircuitColor(): string {
    const circuits = document.value?.circuits ?? []
    return pickNextCircuitColor(
      circuits.map((circuit) => circuit.color),
      circuits.length,
    )
  }

  /** Sets the circuit new wires attach to and the Circuits panel highlights (spec W1/C5). */
  function setActiveCircuit(circuitId: string | null): void {
    activeCircuitId.value = circuitId
  }

  /**
   * Toggles isolation of a circuit (spec C5): isolating a circuit also makes it
   * active; re-isolating the isolated one clears isolation but keeps it active.
   */
  function toggleIsolatedCircuit(circuitId: string): void {
    if (isolatedCircuitId.value === circuitId) {
      isolatedCircuitId.value = null
    } else {
      isolatedCircuitId.value = circuitId
    }
    activeCircuitId.value = circuitId
  }

  function clearIsolation(): void {
    isolatedCircuitId.value = null
  }

  async function loadPlan(id: string): Promise<Plan> {
    const loaded = await getPlan(id)
    adoptPlan(loaded)
    saveState.value = 'idle'
    saveError.value = null
    dirtyDuringSave = false
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    return loaded
  }

  function syncHistoryFlags(): void {
    canUndo.value = undoStack.length > 0
    canRedo.value = redoStack.length > 0
  }

  function pushEntry(entry: HistoryEntry): void {
    undoStack.push(entry)
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
    redoStack = []
    syncHistoryFlags()
  }

  function record(command: EditorCommand, inverse: EditorCommand): void {
    if (transaction) {
      const key = updateKeyOf(command)
      if (key !== null) {
        const existing = transaction.commands.findIndex(
          (candidate) => updateKeyOf(candidate) === key,
        )
        if (existing !== -1) {
          transaction.commands[existing] = command
          return
        }
      }
      transaction.commands.push(command)
      transaction.inverses.push(inverse)
      return
    }
    pushEntry({ commands: [command], inverses: [inverse] })
  }

  function applySingle(command: EditorCommand): void {
    if (!document.value) return
    const inverse = invertCommand(document.value, command)
    if (inverse === undefined) return
    document.value = applyCommand(document.value, command)
    documentVersion.value += 1
    if (inverse !== null) record(command, inverse)
    pruneSelection()
    scheduleSave()
  }

  /**
   * The guides anchored to `wallId`, rewritten as FREE guides on the exact line
   * they occupy right now (spec S9).
   *
   * Deleting a wall must neither take its construction lines with it — the user
   * placed them deliberately, and they often outlive the wall they were measured
   * from — nor leave them naming a wall the document no longer contains. Keeping
   * the world line and dropping the relation is the only outcome that is both.
   * A guide whose anchor is ALREADY broken resolves to nothing and is left
   * untouched: there is no line to preserve.
   */
  function guidesFreedBy(wallId: string): Guide[] {
    const current = document.value
    if (!current) return []
    const network = wallNetwork.value
    const freed: Guide[] = []
    for (const guide of current.guides) {
      if (!guideAnchorsTo(guide, wallId)) continue
      const line = resolveGuideLine(guide, current.walls, network)
      if (!line) continue
      freed.push({
        id: guide.id,
        kind: 'free',
        origin: { ...line.point },
        angle_deg: Math.atan2(line.dir.y, line.dir.x) * RAD_TO_DEG,
      })
    }
    return freed
  }

  function mutate(command: EditorCommand): void {
    if (!document.value) return
    if (command.type === 'removeWall') {
      // Removing a wall cascades to its openings AND its attached devices
      // (spec §4.2: nothing floats), coalesced into ONE undo step with the
      // wall removal itself. Device removals route back through mutate so their
      // own wire/link cascades run too. Guides anchored to the wall are the one
      // exception: they degrade instead of dying with it.
      const hostedOpenings = document.value.openings.filter(
        (opening) => opening.wall_id === command.wallId,
      )
      const hostedDevices = document.value.devices.filter(
        (device) => device.attachment?.wall_id === command.wallId,
      )
      const freedGuides = guidesFreedBy(command.wallId)
      if (hostedOpenings.length > 0 || hostedDevices.length > 0 || freedGuides.length > 0) {
        const ownTransaction = transaction === null
        if (ownTransaction) beginTransaction()
        for (const opening of hostedOpenings) {
          applySingle({ type: 'removeOpening', openingId: opening.id })
        }
        for (const device of hostedDevices) {
          mutate({ type: 'removeDevice', deviceId: device.id })
        }
        for (const guide of freedGuides) {
          applySingle({ type: 'updateGuide', guideId: guide.id, guide })
        }
        applySingle(command)
        if (ownTransaction) commitTransaction()
        return
      }
    }
    if (command.type === 'removeDevice') {
      // Removing a device cascades to every wire touching it and every control
      // link referencing it (spec W5), coalesced into ONE undo step.
      const touchingWires = document.value.wires.filter(
        (wire) =>
          wire.from_device_id === command.deviceId || wire.to_device_id === command.deviceId,
      )
      const referencingLinks = document.value.control_links.filter(
        (link) => link.switch_id === command.deviceId || link.target_id === command.deviceId,
      )
      if (touchingWires.length > 0 || referencingLinks.length > 0) {
        const ownTransaction = transaction === null
        if (ownTransaction) beginTransaction()
        for (const wire of touchingWires) applySingle({ type: 'removeWire', wireId: wire.id })
        for (const link of referencingLinks) {
          applySingle({ type: 'removeControlLink', linkId: link.id })
        }
        applySingle(command)
        if (ownTransaction) commitTransaction()
        return
      }
    }
    if (command.type === 'removeCircuit') {
      // Removing a circuit cascades to its wires (spec C1/§5.6), coalesced into
      // ONE undo step.
      const circuitWires = document.value.wires.filter(
        (wire) => wire.circuit_id === command.circuitId,
      )
      if (circuitWires.length > 0) {
        const ownTransaction = transaction === null
        if (ownTransaction) beginTransaction()
        for (const wire of circuitWires) applySingle({ type: 'removeWire', wireId: wire.id })
        applySingle(command)
        if (ownTransaction) commitTransaction()
        return
      }
    }
    if (command.type === 'updateWall') {
      // Reshaping a wall pulls its relations back into truth (spec S1b/S3a): the
      // neighbours a corner, T or shared surface binds to it move to suit, in
      // ONE undo step with the edit itself. The document stays the truth about
      // where every wall is, so nothing downstream needs a correction pass
      // (docs/WALL_NETWORK.md section 5).
      const ownTransaction = transaction === null
      if (ownTransaction) beginTransaction()
      applySingle(command)
      applyConstraints([command.wallId])
      if (ownTransaction) commitTransaction()
      return
    }
    applySingle(command)
  }

  /**
   * Restores the wall relations disturbed by an edit to `seedWallIds`, as
   * further `updateWall` commands inside the caller's transaction.
   */
  function applyConstraints(seedWallIds: readonly string[]): void {
    const current = document.value
    if (!current) return
    const solution = solveConstraints(current.walls, current.joints, seedWallIds)
    for (const [wallId, wall] of solution.moved) {
      applySingle({ type: 'updateWall', wallId, wall })
    }
  }

  /** Starts coalescing mutations into a single undo step (no-op when one is open). */
  function beginTransaction(): void {
    transaction ??= { commands: [], inverses: [] }
  }

  /**
   * Closes the open transaction, pushing its mutations as ONE undo step.
   *
   * Relations are adopted here rather than per mutation: a drag emits a
   * mutation per pointer move, and deriving connectivity from each of those
   * would record every wall the dragged one brushed past on its way
   * (`docs/WALL_NETWORK.md` §6). A gesture boundary is where the geometry means
   * something.
   */
  function commitTransaction(): void {
    if (!transaction) return
    adoptNewRelations(wallsTouchedBy(transaction.commands))
    const entry = transaction
    transaction = null
    if (entry.commands.length > 0) pushEntry(entry)
  }

  /** Wall ids any command in the batch created or reshaped. */
  function wallsTouchedBy(commands: readonly EditorCommand[]): string[] {
    const ids = new Set<string>()
    for (const command of commands) {
      if (command.type === 'updateWall') ids.add(command.wallId)
      else if (command.type === 'addWall') ids.add(command.wall.id)
    }
    return [...ids]
  }

  /**
   * Records relations the edited geometry now implies but the document does not
   * yet hold — a wall dragged onto another one becomes attached to it.
   *
   * Merge only: a relation the derivation no longer sees is left in place, since
   * keeping connected walls connected is the point (spec S3) and the solver is
   * what re-satisfies it. Ids are derived from the parties, so a relation the
   * document already has is recognised rather than duplicated.
   */
  function adoptNewRelations(touchedWallIds: readonly string[]): void {
    const current = document.value
    if (!current || touchedWallIds.length === 0) return
    const touched = new Set(touchedWallIds)
    const known = new Set(current.joints.map((joint) => joint.id))
    const added = deriveJoints(current.walls).filter(
      (joint) => !known.has(joint.id) && wallIdsOf(joint).some((id) => touched.has(id)),
    )
    if (added.length > 0) applySingle({ type: 'addJoints', joints: added })
  }

  /** Reverts every mutation of the open transaction and discards it. */
  function abortTransaction(): void {
    if (!transaction) return
    const entry = transaction
    transaction = null
    if (!document.value || entry.inverses.length === 0) return
    for (let i = entry.inverses.length - 1; i >= 0; i--) {
      document.value = applyCommand(document.value, entry.inverses[i])
    }
    documentVersion.value += 1
    pruneSelection()
    scheduleSave()
  }

  function undo(): void {
    if (!document.value || transaction) return
    const entry = undoStack.pop()
    if (!entry) {
      syncHistoryFlags()
      return
    }
    for (let i = entry.inverses.length - 1; i >= 0; i--) {
      document.value = applyCommand(document.value, entry.inverses[i])
    }
    redoStack.push(entry)
    documentVersion.value += 1
    syncHistoryFlags()
    pruneSelection()
    scheduleSave()
  }

  function redo(): void {
    if (!document.value || transaction) return
    const entry = redoStack.pop()
    if (!entry) {
      syncHistoryFlags()
      return
    }
    for (const command of entry.commands) {
      document.value = applyCommand(document.value, command)
    }
    undoStack.push(entry)
    documentVersion.value += 1
    syncHistoryFlags()
    pruneSelection()
    scheduleSave()
  }

  function select(refs: readonly ElementRef[], mode: SelectionMode = 'replace'): void {
    const next = new Map<string, ElementRef>(mode === 'replace' ? [] : selection.value)
    for (const entry of refs) {
      const key = selectionKeyOf(entry)
      if (mode === 'toggle' && next.has(key)) {
        next.delete(key)
      } else {
        next.set(key, entry)
      }
    }
    selection.value = next
  }

  function clearSelection(): void {
    if (selection.value.size > 0) selection.value = new Map()
  }

  function isSelected(elementRef: ElementRef): boolean {
    return selection.value.has(selectionKeyOf(elementRef))
  }

  /** Removes the whole selection from the document as a single undo step (spec E4). */
  function deleteSelection(): void {
    if (selection.value.size === 0) return
    beginTransaction()
    // Openings first so a selected opening on a selected wall is not removed
    // twice (the wall removal cascades to its remaining openings itself).
    for (const openingId of selectedOpeningIds.value) {
      mutate({ type: 'removeOpening', openingId })
    }
    for (const stairsId of selectedStairsIds.value) {
      mutate({ type: 'removeStairs', stairsId })
    }
    for (const labelId of selectedLabelIds.value) {
      mutate({ type: 'removeLabel', labelId })
    }
    for (const dimensionId of selectedDimensionIds.value) {
      mutate({ type: 'removeDimension', dimensionId })
    }
    for (const guideId of selectedGuideIds.value) {
      mutate({ type: 'removeGuide', guideId })
    }
    for (const wireId of selectedWireIds.value) {
      mutate({ type: 'removeWire', wireId })
    }
    for (const deviceId of selectedDeviceIds.value) {
      mutate({ type: 'removeDevice', deviceId })
    }
    for (const wallId of selectedWallIds.value) {
      mutate({ type: 'removeWall', wallId })
    }
    if (selectedUnderlay.value) {
      mutate({ type: 'setUnderlay', underlay: null })
    }
    commitTransaction()
  }

  const clipboardCount = computed(() => deviceClipboard.value.length)

  /** Clones a device with a fresh id, offset by ~12" for paste/duplicate (spec D3). */
  function offsetDeviceCopy(device: Device): Device {
    const id = crypto.randomUUID()
    if (device.attachment) {
      const wall = document.value?.walls.find(
        (candidate) => candidate.id === device.attachment?.wall_id,
      )
      const span = wall ? wallSegmentSpan(wall, device.attachment.segment_index) : null
      const targetT = device.attachment.t + PASTE_OFFSET_IN
      const t = span ? Math.max(0, Math.min(targetT, span.lengthIn)) : targetT
      return { ...device, id, attachment: { ...device.attachment, t }, position: null }
    }
    return {
      ...device,
      id,
      attachment: null,
      position: device.position
        ? { x: device.position.x + PASTE_OFFSET_IN, y: device.position.y + PASTE_OFFSET_IN }
        : null,
    }
  }

  /** Copies the selected devices into the session clipboard (spec D3); returns the count. */
  function copySelection(): number {
    const devices = selectedDevices.value
    if (devices.length === 0) return deviceClipboard.value.length
    deviceClipboard.value = devices.map((device) => ({
      ...device,
      attachment: device.attachment ? { ...device.attachment } : null,
      position: device.position ? { ...device.position } : null,
    }))
    return deviceClipboard.value.length
  }

  /** Adds offset clones of a device list as ONE undo step and selects them. */
  function insertDeviceCopies(devices: readonly Device[]): void {
    if (!document.value || devices.length === 0) return
    beginTransaction()
    const refs: ElementRef[] = []
    for (const device of devices) {
      const copy = offsetDeviceCopy(device)
      mutate({ type: 'addDevice', device: copy })
      refs.push({ kind: 'device', id: copy.id })
    }
    commitTransaction()
    if (refs.length > 0) select(refs, 'replace')
  }

  /** Pastes the clipboard devices, each offset ~12" (spec D3); one undo step. */
  function pasteClipboard(): void {
    insertDeviceCopies(deviceClipboard.value)
  }

  /** Duplicates the selected devices in place (Ctrl+D, spec D3); one undo step. */
  function duplicateSelection(): void {
    insertDeviceCopies(selectedDevices.value)
  }

  /** Drops selection entries whose element no longer exists (after remove/undo/redo). */
  function pruneSelection(): void {
    const doc = document.value
    if (!doc || selection.value.size === 0) return
    const existing: Record<ElementKind, ReadonlySet<string>> = {
      wall: new Set(doc.walls.map((wall) => wall.id)),
      opening: new Set(doc.openings.map((opening) => opening.id)),
      stairs: new Set(doc.stairs.map((stairs) => stairs.id)),
      label: new Set(doc.labels.map((label) => label.id)),
      dimension: new Set(doc.dimensions.map((dimension) => dimension.id)),
      device: new Set(doc.devices.map((device) => device.id)),
      wire: new Set(doc.wires.map((wire) => wire.id)),
      guide: new Set(doc.guides.map((guide) => guide.id)),
      underlay: doc.underlay ? new Set([UNDERLAY_ELEMENT_ID]) : new Set(),
    }
    let changed = false
    const next = new Map<string, ElementRef>()
    for (const [key, entry] of selection.value) {
      if (existing[entry.kind].has(entry.id)) {
        next.set(key, entry)
      } else {
        changed = true
      }
    }
    if (changed) selection.value = next
  }

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void saveNow()
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  async function saveNow(): Promise<void> {
    if (!plan.value || !document.value) return
    if (saving) {
      dirtyDuringSave = true
      return
    }
    saving = true
    saveState.value = 'saving'
    const id = plan.value.id
    try {
      const result = await savePlanDocument(id, {
        revision: revision.value,
        document: document.value,
      })
      revision.value = result.revision
      saveState.value = 'saved'
      saveError.value = null
    } catch (error) {
      if (error instanceof ApiError && error.status === HTTP_CONFLICT) {
        await reloadAfterConflict(id)
      } else {
        saveState.value = 'error'
        saveError.value = error instanceof Error ? error.message : 'Autosave failed'
      }
    } finally {
      saving = false
      if (dirtyDuringSave) {
        dirtyDuringSave = false
        scheduleSave()
      }
    }
  }

  async function reloadAfterConflict(id: string): Promise<void> {
    try {
      const fresh = await getPlan(id)
      adoptPlan(fresh)
      saveState.value = 'error'
      saveError.value = 'This plan was modified elsewhere — the latest version has been reloaded.'
      dirtyDuringSave = false
    } catch (error) {
      saveState.value = 'error'
      saveError.value = error instanceof Error ? error.message : 'Autosave failed'
    }
  }

  /** Saves immediately if a debounced save is pending (e.g. when leaving the editor). */
  async function flushPendingSave(): Promise<void> {
    if (!saveTimer) return
    clearTimeout(saveTimer)
    saveTimer = null
    await saveNow()
  }

  /**
   * Patches the open plan's metadata (name and/or description, spec P5) via
   * the PATCH endpoint — metadata lives outside the document, so this never
   * touches the autosave loop or the undo history.
   */
  async function updateCurrentPlanMetadata(patch: PlanMetadataPatch): Promise<void> {
    if (!plan.value) return
    const updated = await updatePlanMetadata(plan.value.id, patch)
    plan.value = {
      ...plan.value,
      name: updated.name,
      description: updated.description,
      updated_at: updated.updated_at,
    }
    revision.value = updated.revision
  }

  return {
    plan,
    document,
    documentVersion,
    revision,
    saveState,
    saveError,
    canUndo,
    canRedo,
    selection,
    wallNetwork,
    guideLines,
    selectedWallIds,
    selectedOpeningIds,
    selectedStairsIds,
    selectedLabelIds,
    selectedDimensionIds,
    selectedDeviceIds,
    selectedWireIds,
    selectedGuideIds,
    selectedWalls,
    selectedOpenings,
    selectedStairs,
    selectedLabels,
    selectedDimensions,
    selectedDevices,
    selectedWires,
    selectedGuides,
    selectedUnderlay,
    displayPrecisionIn,
    activeCircuitId,
    isolatedCircuitId,
    clipboardCount,
    loadPlan,
    nextCircuitColor,
    setActiveCircuit,
    toggleIsolatedCircuit,
    clearIsolation,
    mutate,
    beginTransaction,
    commitTransaction,
    abortTransaction,
    undo,
    redo,
    select,
    clearSelection,
    isSelected,
    deleteSelection,
    copySelection,
    pasteClipboard,
    duplicateSelection,
    flushPendingSave,
    updateCurrentPlanMetadata,
  }
})
