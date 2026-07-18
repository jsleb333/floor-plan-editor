import { computed, ref, shallowRef } from 'vue'
import type { ComputedRef, Ref, ShallowRef } from 'vue'

import { UNDERLAY_ELEMENT_ID } from '@/stores/editor'
import type { EditorCommand, ElementRef, SelectionMode } from '@/stores/editor'
import type {
  Device,
  Dimension,
  Label,
  Opening,
  Point,
  Stairs,
  Underlay,
  Wall,
  Wire,
} from '@/types/plan'
import {
  add,
  boundsIntersect,
  boundsOfPoints,
  boundsOfRings,
  clampOpeningT,
  constrainedVertexPosition,
  deviceWallGaps,
  deviceWorldPlacement,
  dimensionHitTest,
  dimensionLayout,
  dimensionOffsetFor,
  distance,
  dot,
  labelBounds,
  lineIntersection,
  normalize,
  openingWorldRect,
  parallelFaceGaps,
  perpendicular,
  pointInPolygon,
  pointInRings,
  projectDeviceOntoWalls,
  projectOntoWalls,
  projectPointOnPolyline,
  scale,
  stairsCorners,
  sub,
  wallOutline,
  wallSegmentSpan,
  wireEndpoint,
  wireHitDistance,
  sampleWirePoints,
} from '@/utils/geometry'
import type { Bounds, DeviceGaps, FaceGap } from '@/utils/geometry'
import type { ImageSize } from '@/utils/imageSize'
import { underlayContains } from '@/utils/underlay'
import { formatFeetInches, parseFeetInches } from '@/utils/units'

import { GRID_STEP_IN, useSnapping } from './useSnapping'
import type { SnapSettings } from './useSnapping'
import { isBufferKey } from './useWallTool'

/** Pointer travel (screen px) before a press becomes a drag instead of a click. */
const DRAG_START_PX = 4
/** Capture radius (screen px) of a vertex grab handle. */
const HANDLE_RADIUS_PX = 6
/** Capture radius (screen px) for clicking a wire's Bézier curve (spec W2). */
const WIRE_HIT_PX = 6
/** How long the locked-segment refusal highlight stays visible. */
const LOCK_FLASH_MS = 700
/** Arrow-key nudge steps (spec E4): 1", or 12" with Shift. */
const NUDGE_STEP_IN = 1
const NUDGE_BIG_STEP_IN = 12

/** What the editor store must provide; satisfied by `useEditorStore()`. */
export interface SelectToolStore {
  readonly selectedWallIds: ReadonlySet<string>
  readonly selection: ReadonlyMap<string, ElementRef>
  mutate(command: EditorCommand): void
  beginTransaction(): void
  commitTransaction(): void
  abortTransaction(): void
  select(refs: readonly ElementRef[], mode?: SelectionMode): void
  clearSelection(): void
  isSelected(elementRef: ElementRef): boolean
}

export interface UseSelectToolOptions {
  store: SelectToolStore
  /** Current walls of the document (reactive to every mutation). */
  walls: Ref<readonly Wall[]>
  /** Current openings of the document (reactive to every mutation). */
  openings: Ref<readonly Opening[]>
  /** Current stair runs of the document (reactive to every mutation). */
  stairs: Ref<readonly Stairs[]>
  /** Current labels of the document (reactive to every mutation). */
  labels: Ref<readonly Label[]>
  /** Current dimension annotations of the document (reactive to every mutation). */
  dimensions: Ref<readonly Dimension[]>
  /** Current electrical devices of the document (reactive to every mutation). */
  devices: Ref<readonly Device[]>
  /** Current wires of the document (reactive to every mutation). */
  wires: Ref<readonly Wire[]>
  /** Whether a circuit's wires are visible; hidden wires are not hit-testable (spec C6). */
  isCircuitWiresVisible: (circuitId: string) => boolean
  /** Current tracing underlay of the document (reactive to every mutation). */
  underlay: Ref<Underlay | null>
  /** Natural pixel size of the loaded underlay image (null until loaded). */
  underlayImageSize: Ref<ImageSize | null>
  /** Current screen pixels per world inch, for pixel-based thresholds. */
  pixelsPerInch: Ref<number>
  /** Shared snap toggles (grid / angle / walls). */
  snapSettings: SnapSettings
}

/** A temporary dimension chip shown while a segment drags (spec S2a). */
export interface DimensionChip {
  side: 'left' | 'right'
  distanceIn: number
  label: string
  from: Point
  to: Point
  /** The chip a typed value applies to (Tab switches, spec S2a). */
  active: boolean
}

/** Transient refusal highlight for locked segments (spec S3b). */
export interface LockFlash {
  wallId: string
  segments: number[]
}

/** Everything the selection overlay renders (spec E2/E6). */
export interface SelectToolPreview {
  band: Bounds | null
  handles: { wallId: string; vertexIndex: number; point: Point }[]
  /** Draggable control-point handles of the selected wire (spec W2). */
  wireHandles: { wireId: string; handleIndex: number; point: Point }[]
  /** Endpoint markers (device centres) of the selected wire (spec W2). */
  wireEndpoints: Point[]
  chips: DimensionChip[]
  lockFlash: LockFlash | null
  dragging: boolean
}

export interface UseSelectToolReturn {
  preview: ComputedRef<SelectToolPreview>
  inputBuffer: Ref<string>
  isDragging: ComputedRef<boolean>
  onPointerDown: (world: Point, modifiers: { shift: boolean; alt: boolean }) => void
  onPointerMove: (world: Point) => void
  onPointerUp: (world: Point) => void
  /**
   * Routes a key press to the tool; returns true when consumed. Handles
   * Escape (cancel drag / clear selection), Alt, Tab and the typed-dimension
   * buffer during segment drags.
   */
  handleKey: (key: string) => boolean
  setAlt: (held: boolean) => void
  /** Nudges the selection by one step as a single undo step; true when handled (spec E4). */
  nudge: (dx: number, dy: number, big: boolean) => boolean
  /** Flashes a locked-segment refusal (also used by the Inspector's blocked edits). */
  flashLock: (wallId: string, segments: number[]) => void
  /** Cancels any in-flight interaction and clears modifier state (on tool switch). */
  deactivate: () => void
}

type DragIntent =
  | { kind: 'none' }
  | { kind: 'band' }
  | { kind: 'vertex'; wallId: string; vertexIndex: number }
  | { kind: 'segment'; wallId: string; segmentIndex: number }
  | { kind: 'opening'; openingId: string }
  | { kind: 'dimension'; dimensionId: string }
  | { kind: 'device'; deviceId: string }
  | { kind: 'wire'; wireId: string }
  | { kind: 'wireHandle'; wireId: string; handleIndex: number }
  | { kind: 'body'; refs: ElementRef[] }

/** Originals of every translatable element captured when a body drag starts. */
interface BodyOriginals {
  walls: Map<string, Wall>
  stairs: Map<string, Stairs>
  labels: Map<string, Label>
  dimensions: Map<string, Dimension>
  /** Only free/ceiling (positioned) devices; attached ones move with their wall. */
  devices: Map<string, Device>
  underlay: Underlay | null
}

type PointerState =
  | { mode: 'idle' }
  | { mode: 'pending'; intent: DragIntent; startWorld: Point; additive: boolean }
  | { mode: 'band'; anchor: Point; cursor: Point; additive: boolean }
  | { mode: 'vertexDrag'; wallId: string; vertexIndex: number; original: Wall }
  | {
      mode: 'segmentDrag'
      wallId: string
      segmentIndex: number
      original: Wall
      startWorld: Point
      offsetIn: number
    }
  | { mode: 'openingSlide'; original: Opening }
  | { mode: 'deviceSlide'; original: Device; startWorld: Point }
  | { mode: 'dimensionOffset'; original: Dimension }
  | { mode: 'wireDrag'; original: Wire; startWorld: Point }
  | { mode: 'wireHandleDrag'; original: Wire; handleIndex: number }
  | { mode: 'bodyDrag'; originals: BodyOriginals; startWorld: Point }

function wallRef(id: string): ElementRef {
  return { kind: 'wall', id }
}

function toGeometry(wall: Wall) {
  return {
    vertices: wall.vertices,
    thicknessIn: wall.thickness_in,
    reference: wall.reference,
    closed: wall.closed,
  }
}

function translateWall(wall: Wall, delta: Point): Wall {
  return { ...wall, vertices: wall.vertices.map((v) => add(v, delta)) }
}

function translateStairs(stairs: Stairs, delta: Point): Stairs {
  return { ...stairs, origin: add(stairs.origin, delta) }
}

function translateLabel(label: Label, delta: Point): Label {
  return { ...label, position: add(label.position, delta) }
}

function translateDimension(dimension: Dimension, delta: Point): Dimension {
  return { ...dimension, p1: add(dimension.p1, delta), p2: add(dimension.p2, delta) }
}

/** Translates a positioned (free/ceiling) device; attached devices never translate. */
function translateDevice(device: Device, delta: Point): Device {
  if (!device.position) return device
  return { ...device, position: add(device.position, delta) }
}

function translateUnderlay(underlay: Underlay, delta: Point): Underlay {
  return {
    ...underlay,
    transform: { ...underlay.transform, origin: add(underlay.transform.origin, delta) },
  }
}

/** Segment indices adjacent to (touching) a vertex, respecting closed-loop wrap. */
function segmentsAtVertex(wall: Wall, vertexIndex: number): number[] {
  const n = wall.vertices.length
  const segmentCount = wall.closed ? n : n - 1
  const result: number[] = []
  const before = wall.closed ? (vertexIndex - 1 + segmentCount) % segmentCount : vertexIndex - 1
  if (before >= 0 && before < segmentCount) result.push(before)
  if (vertexIndex < segmentCount) result.push(vertexIndex)
  return [...new Set(result)]
}

/** Segment indices adjacent to segment k (the ones a segment drag stretches). */
function segmentsAdjacentTo(wall: Wall, segmentIndex: number): number[] {
  const n = wall.vertices.length
  const segmentCount = wall.closed ? n : n - 1
  const result: number[] = []
  for (const candidate of [segmentIndex - 1, segmentIndex + 1]) {
    const wrapped = wall.closed ? (candidate + segmentCount) % segmentCount : candidate
    if (wrapped >= 0 && wrapped < segmentCount && wrapped !== segmentIndex) result.push(wrapped)
  }
  return [...new Set(result)]
}

/**
 * Select-tool interaction machine (specs E2/E4/S2a/S3/S3b): click and
 * shift-click selection, rubber-band selection, angle-preserving vertex
 * drags, parallel segment drags with temporary dimensions and typed exact
 * gaps, whole-selection body drags, arrow-key nudges and locked-segment
 * refusals. Every drag runs inside a store transaction so it lands on the
 * undo stack as a single step.
 *
 * Headless by design: all inputs are injected and interaction arrives via
 * methods, so the machine is testable without a DOM.
 */
export function useSelectTool(options: UseSelectToolOptions): UseSelectToolReturn {
  const {
    store,
    walls,
    openings,
    stairs,
    labels,
    dimensions,
    devices,
    wires,
    isCircuitWiresVisible,
    underlay,
    underlayImageSize,
    pixelsPerInch,
    snapSettings,
  } = options

  const state: ShallowRef<PointerState> = shallowRef({ mode: 'idle' })
  const inputBuffer = ref('')
  const activeSide = ref<'left' | 'right'>('left')
  const altHeld = ref(false)
  const lockFlashState = shallowRef<LockFlash | null>(null)
  let lockFlashTimer: ReturnType<typeof setTimeout> | null = null
  let lastWorld: Point | null = null

  const draggedWallId = computed(() =>
    state.value.mode === 'vertexDrag' ? state.value.wallId : null,
  )
  const snapping = useSnapping({
    walls: computed(() =>
      draggedWallId.value === null
        ? walls.value
        : walls.value.filter((wall) => wall.id !== draggedWallId.value),
    ),
    pixelsPerInch,
    settings: snapSettings,
  })

  const isDragging = computed(
    () =>
      state.value.mode === 'vertexDrag' ||
      state.value.mode === 'segmentDrag' ||
      state.value.mode === 'openingSlide' ||
      state.value.mode === 'deviceSlide' ||
      state.value.mode === 'dimensionOffset' ||
      state.value.mode === 'wireDrag' ||
      state.value.mode === 'wireHandleDrag' ||
      state.value.mode === 'bodyDrag',
  )

  function thresholdIn(pixels: number): number {
    return pixels / Math.max(pixelsPerInch.value, Number.EPSILON)
  }

  function wallById(id: string): Wall | null {
    return walls.value.find((wall) => wall.id === id) ?? null
  }

  function openingById(id: string): Opening | null {
    return openings.value.find((opening) => opening.id === id) ?? null
  }

  function dimensionById(id: string): Dimension | null {
    return dimensions.value.find((dimension) => dimension.id === id) ?? null
  }

  function deviceById(id: string): Device | null {
    return devices.value.find((device) => device.id === id) ?? null
  }

  function deviceAtPoint(point: Point): Device | null {
    const list = devices.value
    for (let i = list.length - 1; i >= 0; i--) {
      const placement = deviceWorldPlacement(list[i], walls.value)
      if (placement && pointInPolygon(point, placement.bounds)) return list[i]
    }
    return null
  }

  function wireById(id: string): Wire | null {
    return wires.value.find((wire) => wire.id === id) ?? null
  }

  function deviceCenter(deviceId: string): Point | null {
    return wireEndpoint(
      devices.value.find((device) => device.id === deviceId),
      walls.value,
    )
  }

  /** Live endpoint centres of a wire (its devices), or nulls when unresolved. */
  function wireEndpointsOf(wire: Wire): { from: Point | null; to: Point | null } {
    return { from: deviceCenter(wire.from_device_id), to: deviceCenter(wire.to_device_id) }
  }

  /** The nearest wire under the cursor within the hit radius; hidden wires are skipped (spec C6). */
  function wireAtPoint(point: Point): Wire | null {
    const tolerance = thresholdIn(WIRE_HIT_PX)
    let best: Wire | null = null
    let bestDistance = tolerance
    const list = wires.value
    for (let i = list.length - 1; i >= 0; i--) {
      const wire = list[i]
      if (!isCircuitWiresVisible(wire.circuit_id)) continue
      const { from, to } = wireEndpointsOf(wire)
      if (!from || !to) continue
      const gap = wireHitDistance(point, from, wire.control_points, to)
      if (gap <= bestDistance) {
        best = wire
        bestDistance = gap
      }
    }
    return best
  }

  /** The sole selected wire (single selection), for handle hit-testing/rendering. */
  function soleSelectedWire(): Wire | null {
    if (store.selection.size !== 1) return null
    const entry = [...store.selection.values()][0]
    return entry.kind === 'wire' ? wireById(entry.id) : null
  }

  /** A control-point handle of the selected wire under the cursor (spec W2). */
  function wireHandleAt(point: Point): { wireId: string; handleIndex: number } | null {
    const wire = soleSelectedWire()
    if (!wire) return null
    const radius = thresholdIn(HANDLE_RADIUS_PX)
    let best: { wireId: string; handleIndex: number } | null = null
    let bestDistance = radius
    wire.control_points.forEach((point_, handleIndex) => {
      const gap = distance(point, point_)
      if (gap <= bestDistance) {
        best = { wireId: wire.id, handleIndex }
        bestDistance = gap
      }
    })
    return best
  }

  function wallAtPoint(point: Point): Wall | null {
    const list = walls.value
    for (let i = list.length - 1; i >= 0; i--) {
      if (pointInRings(point, wallOutline(toGeometry(list[i])))) return list[i]
    }
    return null
  }

  function openingAtPoint(point: Point): Opening | null {
    const list = openings.value
    for (let i = list.length - 1; i >= 0; i--) {
      const wall = wallById(list[i].wall_id)
      if (!wall) continue
      const rect = openingWorldRect(wall, list[i])
      if (rect && pointInPolygon(point, rect)) return list[i]
    }
    return null
  }

  function stairsAtPoint(point: Point): Stairs | null {
    const list = stairs.value
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].length_in > 0 && pointInPolygon(point, stairsCorners(list[i]))) {
        return list[i]
      }
    }
    return null
  }

  function labelAtPoint(point: Point): Label | null {
    const list = labels.value
    for (let i = list.length - 1; i >= 0; i--) {
      const bounds = labelBounds(list[i])
      if (
        point.x >= bounds.minX &&
        point.x <= bounds.maxX &&
        point.y >= bounds.minY &&
        point.y <= bounds.maxY
      ) {
        return list[i]
      }
    }
    return null
  }

  function dimensionAtPoint(point: Point): Dimension | null {
    const tolerance = thresholdIn(HANDLE_RADIUS_PX)
    const list = dimensions.value
    for (let i = list.length - 1; i >= 0; i--) {
      if (dimensionHitTest(list[i], point, tolerance)) return list[i]
    }
    return null
  }

  /** The underlay hits only when present, visible, unlocked and loaded (spec U3). */
  function underlayAtPoint(point: Point): Underlay | null {
    const current = underlay.value
    const size = underlayImageSize.value
    if (!current || !current.visible || current.locked || !size) return null
    return underlayContains(current.transform, size, point) ? current : null
  }

  /**
   * Topmost element under the cursor. Openings sit on walls, and annotations
   * render above the structure, so they hit before wall bodies; stairs render
   * under walls and hit after them; the underlay sits below everything and
   * hits last (spec U3: lowest priority, and only when unlocked and visible).
   */
  function elementAtPoint(point: Point): ElementRef | null {
    const opening = openingAtPoint(point)
    if (opening) return { kind: 'opening', id: opening.id }
    const dimension = dimensionAtPoint(point)
    if (dimension) return { kind: 'dimension', id: dimension.id }
    const label = labelAtPoint(point)
    if (label) return { kind: 'label', id: label.id }
    const device = deviceAtPoint(point)
    if (device) return { kind: 'device', id: device.id }
    const wire = wireAtPoint(point)
    if (wire) return { kind: 'wire', id: wire.id }
    const wall = wallAtPoint(point)
    if (wall) return wallRef(wall.id)
    const stair = stairsAtPoint(point)
    if (stair) return { kind: 'stairs', id: stair.id }
    if (underlayAtPoint(point)) return { kind: 'underlay', id: UNDERLAY_ELEMENT_ID }
    return null
  }

  function vertexHandleAt(point: Point): { wallId: string; vertexIndex: number } | null {
    const radius = thresholdIn(HANDLE_RADIUS_PX)
    let best: { wallId: string; vertexIndex: number } | null = null
    let bestDistance = Infinity
    for (const wall of walls.value) {
      if (!store.selectedWallIds.has(wall.id)) continue
      for (let i = 0; i < wall.vertices.length; i++) {
        const gap = distance(point, wall.vertices[i])
        if (gap <= radius && gap < bestDistance) {
          best = { wallId: wall.id, vertexIndex: i }
          bestDistance = gap
        }
      }
    }
    return best
  }

  function segmentIndexAt(wall: Wall, point: Point): number {
    const ring = wall.closed ? [...wall.vertices, wall.vertices[0]] : wall.vertices
    return projectPointOnPolyline(point, ring)?.segmentIndex ?? 0
  }

  function flashLock(wallId: string, segments: number[]): void {
    lockFlashState.value = { wallId, segments: [...segments] }
    if (lockFlashTimer) clearTimeout(lockFlashTimer)
    lockFlashTimer = setTimeout(() => {
      lockFlashTimer = null
      lockFlashState.value = null
    }, LOCK_FLASH_MS)
  }

  function onPointerDown(world: Point, modifiers: { shift: boolean; alt: boolean }): void {
    if (state.value.mode !== 'idle') return
    lastWorld = { ...world }

    const handle = vertexHandleAt(world)
    if (handle) {
      state.value = {
        mode: 'pending',
        intent: { kind: 'vertex', ...handle },
        startWorld: { ...world },
        additive: modifiers.shift,
      }
      return
    }

    const wireHandle = wireHandleAt(world)
    if (wireHandle) {
      state.value = {
        mode: 'pending',
        intent: { kind: 'wireHandle', ...wireHandle },
        startWorld: { ...world },
        additive: modifiers.shift,
      }
      return
    }

    const hit = elementAtPoint(world)
    if (hit) {
      if (modifiers.shift) {
        store.select([hit], 'toggle')
        state.value = {
          mode: 'pending',
          intent: { kind: 'none' },
          startWorld: { ...world },
          additive: true,
        }
        return
      }
      if (!store.isSelected(hit)) store.select([hit], 'replace')
      state.value = {
        mode: 'pending',
        intent: intentFor(hit, world),
        startWorld: { ...world },
        additive: false,
      }
      return
    }

    state.value = {
      mode: 'pending',
      intent: { kind: 'band' },
      startWorld: { ...world },
      additive: modifiers.shift,
    }
  }

  /**
   * Drag intent for a pressed element: a solo selection drags in its own way
   * (wall segment drag, opening slide along its wall, dimension offset drag);
   * anything else — including mixed selections — translates as a body.
   */
  function intentFor(hit: ElementRef, world: Point): DragIntent {
    const selection = store.selection
    if (selection.size === 1 && store.isSelected(hit)) {
      if (hit.kind === 'wall') {
        const wall = wallById(hit.id)
        if (wall) {
          return { kind: 'segment', wallId: wall.id, segmentIndex: segmentIndexAt(wall, world) }
        }
      }
      if (hit.kind === 'opening') return { kind: 'opening', openingId: hit.id }
      if (hit.kind === 'dimension') return { kind: 'dimension', dimensionId: hit.id }
      if (hit.kind === 'device') return { kind: 'device', deviceId: hit.id }
      if (hit.kind === 'wire') return { kind: 'wire', wireId: hit.id }
    }
    return { kind: 'body', refs: [...selection.values()] }
  }

  function activateDrag(pending: Extract<PointerState, { mode: 'pending' }>, world: Point): void {
    const intent = pending.intent
    if (intent.kind === 'none') return
    if (intent.kind === 'band') {
      state.value = {
        mode: 'band',
        anchor: pending.startWorld,
        cursor: { ...world },
        additive: pending.additive,
      }
      return
    }
    if (intent.kind === 'vertex') {
      const wall = wallById(intent.wallId)
      if (!wall) return
      const locked = segmentsAtVertex(wall, intent.vertexIndex).filter((segment) =>
        wall.locked_segments.includes(segment),
      )
      if (locked.length > 0) {
        flashLock(wall.id, locked)
        state.value = { mode: 'idle' }
        return
      }
      store.beginTransaction()
      state.value = {
        mode: 'vertexDrag',
        wallId: wall.id,
        vertexIndex: intent.vertexIndex,
        original: wall,
      }
      return
    }
    if (intent.kind === 'segment') {
      const wall = wallById(intent.wallId)
      if (!wall) return
      const involved = [intent.segmentIndex, ...segmentsAdjacentTo(wall, intent.segmentIndex)]
      const locked = involved.filter((segment) => wall.locked_segments.includes(segment))
      if (locked.length > 0) {
        flashLock(wall.id, locked)
        state.value = { mode: 'idle' }
        return
      }
      store.beginTransaction()
      inputBuffer.value = ''
      activeSide.value = 'left'
      state.value = {
        mode: 'segmentDrag',
        wallId: wall.id,
        segmentIndex: intent.segmentIndex,
        original: wall,
        startWorld: pending.startWorld,
        offsetIn: 0,
      }
      return
    }
    if (intent.kind === 'opening') {
      const opening = openingById(intent.openingId)
      if (!opening || !wallById(opening.wall_id)) {
        state.value = { mode: 'idle' }
        return
      }
      store.beginTransaction()
      state.value = { mode: 'openingSlide', original: opening }
      return
    }
    if (intent.kind === 'dimension') {
      const dimension = dimensionById(intent.dimensionId)
      if (!dimension) {
        state.value = { mode: 'idle' }
        return
      }
      store.beginTransaction()
      state.value = { mode: 'dimensionOffset', original: dimension }
      return
    }
    if (intent.kind === 'device') {
      const device = deviceById(intent.deviceId)
      if (!device) {
        state.value = { mode: 'idle' }
        return
      }
      store.beginTransaction()
      inputBuffer.value = ''
      activeSide.value = 'left'
      state.value = { mode: 'deviceSlide', original: device, startWorld: pending.startWorld }
      return
    }
    if (intent.kind === 'wire') {
      const wire = wireById(intent.wireId)
      if (!wire) {
        state.value = { mode: 'idle' }
        return
      }
      store.beginTransaction()
      state.value = { mode: 'wireDrag', original: wire, startWorld: pending.startWorld }
      return
    }
    if (intent.kind === 'wireHandle') {
      const wire = wireById(intent.wireId)
      if (!wire) {
        state.value = { mode: 'idle' }
        return
      }
      store.beginTransaction()
      state.value = { mode: 'wireHandleDrag', original: wire, handleIndex: intent.handleIndex }
      return
    }
    const originals: BodyOriginals = {
      walls: new Map(),
      stairs: new Map(),
      labels: new Map(),
      dimensions: new Map(),
      devices: new Map(),
      underlay: null,
    }
    for (const ref of intent.refs) {
      if (ref.kind === 'wall') {
        const wall = wallById(ref.id)
        if (wall) originals.walls.set(ref.id, wall)
      } else if (ref.kind === 'stairs') {
        const stair = stairs.value.find((candidate) => candidate.id === ref.id)
        if (stair) originals.stairs.set(ref.id, stair)
      } else if (ref.kind === 'label') {
        const label = labels.value.find((candidate) => candidate.id === ref.id)
        if (label) originals.labels.set(ref.id, label)
      } else if (ref.kind === 'dimension') {
        const dimension = dimensionById(ref.id)
        if (dimension) originals.dimensions.set(ref.id, dimension)
      } else if (ref.kind === 'device') {
        // Only positioned devices translate; attached ones move with their wall.
        const device = deviceById(ref.id)
        if (device?.position) originals.devices.set(ref.id, device)
      } else if (ref.kind === 'underlay') {
        const current = underlay.value
        if (current && !current.locked) originals.underlay = current
      }
      // Openings are parametric (spec §4.2): they only move with their wall.
    }
    const lockedWall = [...originals.walls.values()].find((wall) => wall.locked_segments.length > 0)
    if (lockedWall) {
      flashLock(lockedWall.id, [...lockedWall.locked_segments])
      state.value = { mode: 'idle' }
      return
    }
    const total =
      originals.walls.size +
      originals.stairs.size +
      originals.labels.size +
      originals.dimensions.size +
      originals.devices.size +
      (originals.underlay ? 1 : 0)
    if (total === 0) {
      state.value = { mode: 'idle' }
      return
    }
    store.beginTransaction()
    state.value = { mode: 'bodyDrag', originals, startWorld: pending.startWorld }
  }

  function onPointerMove(world: Point): void {
    lastWorld = { ...world }
    const current = state.value
    if (current.mode === 'pending') {
      if (distance(world, current.startWorld) > thresholdIn(DRAG_START_PX)) {
        activateDrag(current, world)
        applyDrag(world)
      }
      return
    }
    if (current.mode === 'band') {
      state.value = { ...current, cursor: { ...world } }
      return
    }
    applyDrag(world)
  }

  function applyDrag(world: Point): void {
    const current = state.value
    if (current.mode === 'vertexDrag') {
      applyVertexDrag(current, world)
    } else if (current.mode === 'segmentDrag') {
      const original = current.original
      const n = original.vertices.length
      const a = original.vertices[current.segmentIndex]
      const b = original.vertices[(current.segmentIndex + 1) % n]
      const p = perpendicular(normalize(sub(b, a)))
      let offset = dot(sub(world, current.startWorld), p)
      if (snapSettings.grid.value) offset = Math.round(offset / GRID_STEP_IN) * GRID_STEP_IN
      applySegmentOffset(current, offset)
    } else if (current.mode === 'openingSlide') {
      applyOpeningSlide(current, world)
    } else if (current.mode === 'deviceSlide') {
      applyDeviceSlide(current, world)
    } else if (current.mode === 'wireHandleDrag') {
      applyWireHandleDrag(current, world)
    } else if (current.mode === 'wireDrag') {
      applyWireDrag(current, world)
    } else if (current.mode === 'dimensionOffset') {
      const original = current.original
      let offset = dimensionOffsetFor(original, world)
      if (snapSettings.grid.value) offset = Math.round(offset / GRID_STEP_IN) * GRID_STEP_IN
      store.mutate({
        type: 'updateDimension',
        dimensionId: original.id,
        dimension: { ...original, offset_in: offset },
      })
    } else if (current.mode === 'bodyDrag') {
      let delta = sub(world, current.startWorld)
      if (snapSettings.grid.value) {
        delta = {
          x: Math.round(delta.x / GRID_STEP_IN) * GRID_STEP_IN,
          y: Math.round(delta.y / GRID_STEP_IN) * GRID_STEP_IN,
        }
      }
      for (const [id, original] of current.originals.walls) {
        store.mutate({ type: 'updateWall', wallId: id, wall: translateWall(original, delta) })
      }
      for (const [id, original] of current.originals.stairs) {
        store.mutate({
          type: 'updateStairs',
          stairsId: id,
          stairs: translateStairs(original, delta),
        })
      }
      for (const [id, original] of current.originals.labels) {
        store.mutate({ type: 'updateLabel', labelId: id, label: translateLabel(original, delta) })
      }
      for (const [id, original] of current.originals.dimensions) {
        store.mutate({
          type: 'updateDimension',
          dimensionId: id,
          dimension: translateDimension(original, delta),
        })
      }
      for (const [id, original] of current.originals.devices) {
        store.mutate({
          type: 'updateDevice',
          deviceId: id,
          device: translateDevice(original, delta),
        })
      }
      if (current.originals.underlay) {
        store.mutate({
          type: 'setUnderlay',
          underlay: translateUnderlay(current.originals.underlay, delta),
        })
      }
    }
  }

  /**
   * Slides an opening along its host wall (spec §4.2): the cursor projects
   * onto the wall's reference line — crossing into another segment of the
   * same wall updates `segment_index` — and `t` clamps so the opening stays
   * within its segment.
   */
  function applyOpeningSlide(
    current: Extract<PointerState, { mode: 'openingSlide' }>,
    world: Point,
  ): void {
    const original = current.original
    const host = wallById(original.wall_id)
    if (!host) return
    const placement = projectOntoWalls(world, [host], Infinity)
    if (!placement) return
    const span = wallSegmentSpan(host, placement.segmentIndex)
    if (!span) return
    store.mutate({
      type: 'updateOpening',
      openingId: original.id,
      opening: {
        ...original,
        segment_index: placement.segmentIndex,
        t: clampOpeningT(placement.tIn, original.width_in, span.lengthIn),
      },
    })
  }

  /**
   * Drags a device (spec §4.2/D1). An attached device slides along its host
   * wall: the cursor projects onto the wall, crossing into another segment
   * updates `segment_index`, crossing to the other face flips `side`, and `t`
   * clamps to the segment span. A positioned (free/ceiling) device translates
   * with grid snap.
   */
  function applyDeviceSlide(
    current: Extract<PointerState, { mode: 'deviceSlide' }>,
    world: Point,
  ): void {
    const original = current.original
    if (original.attachment) {
      const host = wallById(original.attachment.wall_id)
      if (!host) return
      const placement = projectDeviceOntoWalls(world, [host], Infinity)
      if (!placement) return
      const span = wallSegmentSpan(host, placement.segmentIndex)
      if (!span) return
      store.mutate({
        type: 'updateDevice',
        deviceId: original.id,
        device: {
          ...original,
          attachment: {
            ...original.attachment,
            segment_index: placement.segmentIndex,
            t: Math.max(0, Math.min(placement.tIn, span.lengthIn)),
            side: placement.side,
          },
        },
      })
      return
    }
    if (!original.position) return
    let delta = sub(world, current.startWorld)
    if (snapSettings.grid.value) {
      delta = {
        x: Math.round(delta.x / GRID_STEP_IN) * GRID_STEP_IN,
        y: Math.round(delta.y / GRID_STEP_IN) * GRID_STEP_IN,
      }
    }
    store.mutate({
      type: 'updateDevice',
      deviceId: original.id,
      device: translateDevice(original, delta),
    })
  }

  function snapToGrid(point: Point): Point {
    if (!snapSettings.grid.value) return point
    return {
      x: Math.round(point.x / GRID_STEP_IN) * GRID_STEP_IN,
      y: Math.round(point.y / GRID_STEP_IN) * GRID_STEP_IN,
    }
  }

  /** Drags one control point of the selected wire freely (spec W2), grid-snapped if enabled. */
  function applyWireHandleDrag(
    current: Extract<PointerState, { mode: 'wireHandleDrag' }>,
    world: Point,
  ): void {
    const original = current.original
    const controlPoints = original.control_points.map((point_, index) =>
      index === current.handleIndex ? snapToGrid(world) : { ...point_ },
    )
    store.mutate({
      type: 'updateWire',
      wireId: original.id,
      wire: { ...original, control_points: controlPoints },
    })
  }

  /** Drags the whole wire curve, translating every control point (spec W2). */
  function applyWireDrag(current: Extract<PointerState, { mode: 'wireDrag' }>, world: Point): void {
    const original = current.original
    let delta = sub(world, current.startWorld)
    if (snapSettings.grid.value) {
      delta = {
        x: Math.round(delta.x / GRID_STEP_IN) * GRID_STEP_IN,
        y: Math.round(delta.y / GRID_STEP_IN) * GRID_STEP_IN,
      }
    }
    const controlPoints = original.control_points.map((point_) => add(point_, delta))
    store.mutate({
      type: 'updateWire',
      wireId: original.id,
      wire: { ...original, control_points: controlPoints },
    })
  }

  function applyVertexDrag(
    current: Extract<PointerState, { mode: 'vertexDrag' }>,
    world: Point,
  ): void {
    const original = current.original
    const n = original.vertices.length
    let position: Point
    if (altHeld.value || !snapSettings.angle.value) {
      position = snapping.resolve(world, null, false).point
    } else {
      const prev =
        current.vertexIndex > 0 || original.closed
          ? original.vertices[(current.vertexIndex - 1 + n) % n]
          : null
      const next =
        current.vertexIndex < n - 1 || original.closed
          ? original.vertices[(current.vertexIndex + 1) % n]
          : null
      position = constrainedVertexPosition(prev, next, world)
    }
    const vertices = original.vertices.map((v, index) =>
      index === current.vertexIndex ? position : { ...v },
    )
    store.mutate({ type: 'updateWall', wallId: original.id, wall: { ...original, vertices } })
  }

  function applySegmentOffset(
    current: Extract<PointerState, { mode: 'segmentDrag' }>,
    offset: number,
  ): void {
    const original = current.original
    const n = original.vertices.length
    const aIndex = current.segmentIndex
    const bIndex = (current.segmentIndex + 1) % n
    const a = original.vertices[aIndex]
    const b = original.vertices[bIndex]
    const u = normalize(sub(b, a))
    const move = scale(perpendicular(u), offset)

    const vertices = original.vertices.map((v) => ({ ...v }))
    vertices[aIndex] = solveStretchedJoint(original, aIndex, bIndex, move, u, 'before')
    vertices[bIndex] = solveStretchedJoint(original, aIndex, bIndex, move, u, 'after')

    state.value = { ...current, offsetIn: offset }
    store.mutate({ type: 'updateWall', wallId: original.id, wall: { ...original, vertices } })
  }

  /**
   * New position of one endpoint of a dragged segment: the intersection of
   * the segment's translated line with the adjacent segment's original line,
   * so the adjacent segment stretches while keeping its direction (spec S3).
   * Chain ends and collinear neighbours translate with the segment.
   */
  function solveStretchedJoint(
    wall: Wall,
    aIndex: number,
    bIndex: number,
    move: Point,
    u: Point,
    side: 'before' | 'after',
  ): Point {
    const n = wall.vertices.length
    const jointIndex = side === 'before' ? aIndex : bIndex
    const joint = wall.vertices[jointIndex]
    const fallback = add(joint, move)
    let neighbourIndex: number
    if (side === 'before') {
      if (jointIndex === 0 && !wall.closed) return fallback
      neighbourIndex = (jointIndex - 1 + n) % n
    } else {
      if (jointIndex === n - 1 && !wall.closed) return fallback
      neighbourIndex = (jointIndex + 1) % n
    }
    const neighbour = wall.vertices[neighbourIndex]
    const neighbourDir = normalize(sub(joint, neighbour))
    return lineIntersection(add(joint, move), u, neighbour, neighbourDir) ?? fallback
  }

  function currentGaps(current: Extract<PointerState, { mode: 'segmentDrag' }>): {
    left: FaceGap | null
    right: FaceGap | null
  } {
    const wall = wallById(current.wallId) ?? current.original
    const n = wall.vertices.length
    return parallelFaceGaps(
      {
        a: wall.vertices[current.segmentIndex],
        b: wall.vertices[(current.segmentIndex + 1) % n],
        thicknessIn: wall.thickness_in,
        reference: wall.reference,
      },
      walls.value,
      { wallId: wall.id, segmentIndex: current.segmentIndex },
    )
  }

  function effectiveSide<T>(gaps: { left: T | null; right: T | null }): 'left' | 'right' {
    if (gaps[activeSide.value]) return activeSide.value
    return activeSide.value === 'left' ? 'right' : 'left'
  }

  /** Live along-wall gaps for the device being slid (spec S2a). */
  function currentDeviceGaps(current: Extract<PointerState, { mode: 'deviceSlide' }>): DeviceGaps {
    const device = deviceById(current.original.id) ?? current.original
    if (!device.attachment) return { left: null, right: null }
    const host = wallById(device.attachment.wall_id)
    if (!host) return { left: null, right: null }
    return deviceWallGaps(
      host,
      device.attachment.segment_index,
      device.attachment.t,
      device.attachment.side,
      walls.value,
    )
  }

  function onPointerUp(world: Point): void {
    const current = state.value
    if (current.mode === 'pending') {
      if (current.intent.kind === 'band' && !current.additive) store.clearSelection()
      state.value = { mode: 'idle' }
      return
    }
    if (current.mode === 'band') {
      applyBandSelection({ ...current, cursor: { ...world } })
      state.value = { mode: 'idle' }
      return
    }
    if (current.mode !== 'idle') {
      store.commitTransaction()
      inputBuffer.value = ''
      state.value = { mode: 'idle' }
    }
  }

  /** Bounds of one element for band selection (spec E2); `null` when degenerate. */
  function elementBounds(ref: ElementRef): Bounds | null {
    if (ref.kind === 'wall') {
      const wall = wallById(ref.id)
      return wall ? boundsOfRings(wallOutline(toGeometry(wall))) : null
    }
    if (ref.kind === 'opening') {
      const opening = openingById(ref.id)
      const wall = opening ? wallById(opening.wall_id) : null
      if (!opening || !wall) return null
      const rect = openingWorldRect(wall, opening)
      return rect ? boundsOfPoints(rect) : null
    }
    if (ref.kind === 'stairs') {
      const stair = stairs.value.find((candidate) => candidate.id === ref.id)
      return stair ? boundsOfPoints(stairsCorners(stair)) : null
    }
    if (ref.kind === 'label') {
      const label = labels.value.find((candidate) => candidate.id === ref.id)
      return label ? labelBounds(label) : null
    }
    if (ref.kind === 'device') {
      const device = deviceById(ref.id)
      const placement = device ? deviceWorldPlacement(device, walls.value) : null
      return placement ? boundsOfPoints(placement.bounds) : null
    }
    if (ref.kind === 'wire') {
      const wire = wireById(ref.id)
      if (!wire) return null
      const { from, to } = wireEndpointsOf(wire)
      if (!from || !to) return null
      return boundsOfPoints(sampleWirePoints(from, wire.control_points, to))
    }
    const dimension = dimensionById(ref.id)
    if (!dimension) return null
    const layout = dimensionLayout(dimension)
    const points = layout
      ? [dimension.p1, dimension.p2, layout.line.a, layout.line.b, layout.textAnchor]
      : [dimension.p1, dimension.p2]
    return boundsOfPoints(points)
  }

  function applyBandSelection(current: Extract<PointerState, { mode: 'band' }>): void {
    const band = boundsOfPoints([current.anchor, current.cursor])
    if (!band) return
    const refs: ElementRef[] = []
    const candidates: ElementRef[] = [
      ...walls.value.map((wall) => wallRef(wall.id)),
      ...openings.value.map((opening): ElementRef => ({ kind: 'opening', id: opening.id })),
      ...stairs.value.map((stair): ElementRef => ({ kind: 'stairs', id: stair.id })),
      ...labels.value.map((label): ElementRef => ({ kind: 'label', id: label.id })),
      ...dimensions.value.map((dim): ElementRef => ({ kind: 'dimension', id: dim.id })),
      ...devices.value.map((device): ElementRef => ({ kind: 'device', id: device.id })),
      ...wires.value
        .filter((wire) => isCircuitWiresVisible(wire.circuit_id))
        .map((wire): ElementRef => ({ kind: 'wire', id: wire.id })),
    ]
    for (const candidate of candidates) {
      const bounds = elementBounds(candidate)
      if (bounds && boundsIntersect(band, bounds)) refs.push(candidate)
    }
    store.select(refs, current.additive ? 'add' : 'replace')
  }

  function cancelDrag(): boolean {
    const current = state.value
    if (current.mode === 'band' || current.mode === 'pending') {
      state.value = { mode: 'idle' }
      return true
    }
    if (current.mode !== 'idle') {
      store.abortTransaction()
      inputBuffer.value = ''
      state.value = { mode: 'idle' }
      return true
    }
    return false
  }

  function applyTypedGap(current: Extract<PointerState, { mode: 'segmentDrag' }>): void {
    const typed = parseFeetInches(inputBuffer.value)
    inputBuffer.value = ''
    if (typed === null || typed < 0) return
    const gaps = currentGaps(current)
    const side = effectiveSide(gaps)
    const gap = gaps[side]
    if (!gap) return
    const adjust = gap.distanceIn - typed
    const offset = current.offsetIn + (side === 'left' ? adjust : -adjust)
    applySegmentOffset(current, offset)
    store.commitTransaction()
    state.value = { mode: 'idle' }
  }

  /** Repositions a sliding device so the active-side gap equals the typed value (spec S2a). */
  function applyTypedDeviceGap(current: Extract<PointerState, { mode: 'deviceSlide' }>): void {
    const typed = parseFeetInches(inputBuffer.value)
    inputBuffer.value = ''
    if (typed === null || typed < 0) return
    const device = deviceById(current.original.id) ?? current.original
    if (!device.attachment) return
    const gaps = currentDeviceGaps(current)
    const side = effectiveSide(gaps)
    const gap = gaps[side]
    if (!gap) return
    const host = wallById(device.attachment.wall_id)
    const span = host ? wallSegmentSpan(host, device.attachment.segment_index) : null
    if (!span) return
    const rawT = side === 'left' ? gap.featureT + typed : gap.featureT - typed
    const t = Math.max(0, Math.min(rawT, span.lengthIn))
    store.mutate({
      type: 'updateDevice',
      deviceId: device.id,
      device: { ...device, attachment: { ...device.attachment, t } },
    })
    store.commitTransaction()
    state.value = { mode: 'idle' }
  }

  function handleKey(key: string): boolean {
    if (key === 'Alt') {
      setAlt(true)
      return isDragging.value
    }
    if (key === 'Escape') {
      if (cancelDrag()) return true
      if (store.selection.size > 0) {
        store.clearSelection()
        return true
      }
      return false
    }
    const current = state.value
    if (current.mode !== 'segmentDrag' && current.mode !== 'deviceSlide') return false
    if (key === 'Tab') {
      activeSide.value = activeSide.value === 'left' ? 'right' : 'left'
      return true
    }
    if (key === 'Enter') {
      if (inputBuffer.value === '') return false
      if (current.mode === 'segmentDrag') applyTypedGap(current)
      else applyTypedDeviceGap(current)
      return true
    }
    if (key === 'Backspace') {
      if (inputBuffer.value === '') return false
      inputBuffer.value = inputBuffer.value.slice(0, -1)
      return true
    }
    if (isBufferKey(key)) {
      if (key === ' ' && inputBuffer.value === '') return false
      inputBuffer.value += key
      return true
    }
    return false
  }

  function setAlt(held: boolean): void {
    if (altHeld.value === held) return
    altHeld.value = held
    if (state.value.mode === 'vertexDrag' && lastWorld) applyDrag(lastWorld)
  }

  function nudge(dx: number, dy: number, big: boolean): boolean {
    const wallIds = store.selectedWallIds
    const selectedWalls = walls.value.filter((wall) => wallIds.has(wall.id))
    const selectedStairs = stairs.value.filter((stair) =>
      store.isSelected({ kind: 'stairs', id: stair.id }),
    )
    const selectedLabels = labels.value.filter((label) =>
      store.isSelected({ kind: 'label', id: label.id }),
    )
    const selectedDimensions = dimensions.value.filter((dimension) =>
      store.isSelected({ kind: 'dimension', id: dimension.id }),
    )
    // Only positioned devices nudge; attached ones are parametric to their wall.
    const selectedDevices = devices.value.filter(
      (device) => device.position && store.isSelected({ kind: 'device', id: device.id }),
    )
    const selectedUnderlay =
      store.isSelected({ kind: 'underlay', id: UNDERLAY_ELEMENT_ID }) &&
      underlay.value &&
      !underlay.value.locked
        ? underlay.value
        : null
    const total =
      selectedWalls.length +
      selectedStairs.length +
      selectedLabels.length +
      selectedDimensions.length +
      selectedDevices.length +
      (selectedUnderlay ? 1 : 0)
    if (total === 0) return false
    const lockedWall = selectedWalls.find((wall) => wall.locked_segments.length > 0)
    if (lockedWall) {
      flashLock(lockedWall.id, [...lockedWall.locked_segments])
      return true
    }
    const step = big ? NUDGE_BIG_STEP_IN : NUDGE_STEP_IN
    const delta = { x: dx * step, y: dy * step }
    store.beginTransaction()
    for (const wall of selectedWalls) {
      store.mutate({ type: 'updateWall', wallId: wall.id, wall: translateWall(wall, delta) })
    }
    for (const stair of selectedStairs) {
      store.mutate({
        type: 'updateStairs',
        stairsId: stair.id,
        stairs: translateStairs(stair, delta),
      })
    }
    for (const label of selectedLabels) {
      store.mutate({ type: 'updateLabel', labelId: label.id, label: translateLabel(label, delta) })
    }
    for (const dimension of selectedDimensions) {
      store.mutate({
        type: 'updateDimension',
        dimensionId: dimension.id,
        dimension: translateDimension(dimension, delta),
      })
    }
    for (const device of selectedDevices) {
      store.mutate({
        type: 'updateDevice',
        deviceId: device.id,
        device: translateDevice(device, delta),
      })
    }
    if (selectedUnderlay) {
      store.mutate({ type: 'setUnderlay', underlay: translateUnderlay(selectedUnderlay, delta) })
    }
    store.commitTransaction()
    return true
  }

  const preview = computed<SelectToolPreview>(() => {
    const current = state.value

    const handles: SelectToolPreview['handles'] = []
    for (const wall of walls.value) {
      if (!store.selectedWallIds.has(wall.id)) continue
      wall.vertices.forEach((point, vertexIndex) => {
        handles.push({ wallId: wall.id, vertexIndex, point })
      })
    }

    let band: Bounds | null = null
    if (current.mode === 'band') {
      band = boundsOfPoints([current.anchor, current.cursor])
    }

    const wireHandles: SelectToolPreview['wireHandles'] = []
    const wireEndpoints: Point[] = []
    const selectedWire = soleSelectedWire()
    if (selectedWire) {
      selectedWire.control_points.forEach((point, handleIndex) => {
        wireHandles.push({ wireId: selectedWire.id, handleIndex, point })
      })
      const { from, to } = wireEndpointsOf(selectedWire)
      if (from) wireEndpoints.push(from)
      if (to) wireEndpoints.push(to)
    }

    const chips: DimensionChip[] = []
    if (current.mode === 'segmentDrag') {
      const gaps = currentGaps(current)
      const active = effectiveSide(gaps)
      for (const gap of [gaps.left, gaps.right]) {
        if (!gap) continue
        chips.push({
          side: gap.side,
          distanceIn: gap.distanceIn,
          label: formatFeetInches(gap.distanceIn),
          from: gap.from,
          to: gap.to,
          active: gap.side === active,
        })
      }
    } else if (current.mode === 'deviceSlide') {
      const gaps = currentDeviceGaps(current)
      const active = effectiveSide(gaps)
      for (const gap of [gaps.left, gaps.right]) {
        if (!gap) continue
        chips.push({
          side: gap.side,
          distanceIn: gap.distanceIn,
          label: formatFeetInches(gap.distanceIn),
          from: gap.from,
          to: gap.to,
          active: gap.side === active,
        })
      }
    }

    return {
      band,
      handles,
      wireHandles,
      wireEndpoints,
      chips,
      lockFlash: lockFlashState.value,
      dragging: isDragging.value,
    }
  })

  function deactivate(): void {
    cancelDrag()
    inputBuffer.value = ''
    altHeld.value = false
    lastWorld = null
    if (lockFlashTimer) {
      clearTimeout(lockFlashTimer)
      lockFlashTimer = null
    }
    lockFlashState.value = null
  }

  return {
    preview,
    inputBuffer,
    isDragging,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    handleKey,
    setAlt,
    nudge,
    flashLock,
    deactivate,
  }
}
