<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { assetUrl } from '@/api/assets'
import CalibrateOverlay from '@/components/editor/CalibrateOverlay.vue'
import ControlLinksLayer from '@/components/editor/ControlLinksLayer.vue'
import DeviceToolOverlay from '@/components/editor/DeviceToolOverlay.vue'
import DevicesLayer from '@/components/editor/DevicesLayer.vue'
import DimensionsLayer from '@/components/editor/DimensionsLayer.vue'
import EditorSidePanel from '@/components/editor/EditorSidePanel.vue'
import ExportDialog from '@/components/editor/ExportDialog.vue'
import EditorStatusBar from '@/components/editor/EditorStatusBar.vue'
import EditorTopBar from '@/components/editor/EditorTopBar.vue'
import LabelsLayer from '@/components/editor/LabelsLayer.vue'
import OpeningsLayer from '@/components/editor/OpeningsLayer.vue'
import SelectionOverlay from '@/components/editor/SelectionOverlay.vue'
import ShortcutOverlay from '@/components/editor/ShortcutOverlay.vue'
import StairsLayer from '@/components/editor/StairsLayer.vue'
import ToolRail from '@/components/editor/ToolRail.vue'
import UnderlayLayer from '@/components/editor/UnderlayLayer.vue'
import ViewportCanvas from '@/components/editor/ViewportCanvas.vue'
import WallToolOverlay from '@/components/editor/WallToolOverlay.vue'
import WallsLayer from '@/components/editor/WallsLayer.vue'
import WiresLayer from '@/components/editor/WiresLayer.vue'
import { TOOLS } from '@/components/editor/tools'
import type { ToolId } from '@/components/editor/tools'
import { useCalibrateTool } from '@/composables/useCalibrateTool'
import { useCircuitValidation } from '@/composables/useCircuitValidation'
import { useDeviceTool } from '@/composables/useDeviceTool'
import { useDimensionTool } from '@/composables/useDimensionTool'
import { useOpeningTool } from '@/composables/useOpeningTool'
import { useSelectTool } from '@/composables/useSelectTool'
import { useSnapSettings } from '@/composables/useSnapSettings'
import { useSnapping } from '@/composables/useSnapping'
import type { SnapToggleId } from '@/composables/useSnapping'
import { useStairsTool } from '@/composables/useStairsTool'
import { isTypingTarget, useToolShortcuts } from '@/composables/useToolShortcuts'
import { BASE_PIXELS_PER_INCH } from '@/composables/useViewport'
import { useWireTool } from '@/composables/useWireTool'
import { isBufferKey, useWallTool } from '@/composables/useWallTool'
import { planIdFromRoute } from '@/router'
import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type {
  Circuit,
  ControlLink,
  Device,
  DeviceType,
  Dimension,
  Label,
  Opening,
  Point,
  Stairs,
  Underlay,
  Viewport,
  Wall,
  Wire,
} from '@/types/plan'
import { controlLinkKind } from '@/utils/circuits'
import { deviceWorldPlacement, pointInPolygon } from '@/utils/geometry'
import { loadImageSize } from '@/utils/imageSize'
import type { ImageSize } from '@/utils/imageSize'

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' }

/** Default text and cap height of a freshly placed label (spec S7). */
const DEFAULT_LABEL_TEXT = 'Room'
const DEFAULT_LABEL_SIZE_IN = 8

const ARROW_NUDGES: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
}

const route = useRoute()
const editorStore = useEditorStore()
const layersStore = useLayersStore()
const { plan, document: planDocument, saveState, saveError } = storeToRefs(editorStore)
const { validation } = useCircuitValidation()

const loadState = ref<LoadState>({ status: 'loading' })
const activeTool = ref<ToolId>('select')
const cursorWorld = ref<Point | null>(null)
const currentViewport = ref<Viewport | null>(null)
const initialViewport = ref<Viewport | null>(null)
const pageError = ref<string | null>(null)
const canvas = ref<InstanceType<typeof ViewportCanvas> | null>(null)

const planId = computed(() => planIdFromRoute(route))
const zoomPercent = computed(() => Math.round((currentViewport.value?.zoom ?? 1) * 100))
const thicknessPresetsIn = computed<readonly number[]>(
  () => planDocument.value?.thickness_presets_in ?? [],
)
const documentWalls = computed<readonly Wall[]>(() => planDocument.value?.walls ?? [])
const documentOpenings = computed<readonly Opening[]>(() => planDocument.value?.openings ?? [])
const documentStairs = computed<readonly Stairs[]>(() => planDocument.value?.stairs ?? [])
const documentLabels = computed<readonly Label[]>(() => planDocument.value?.labels ?? [])
const documentDimensions = computed<readonly Dimension[]>(
  () => planDocument.value?.dimensions ?? [],
)
const documentDevices = computed<readonly Device[]>(() => planDocument.value?.devices ?? [])
const documentWires = computed<readonly Wire[]>(() => planDocument.value?.wires ?? [])
const documentCircuits = computed<readonly Circuit[]>(() => planDocument.value?.circuits ?? [])
const documentControlLinks = computed<readonly ControlLink[]>(
  () => planDocument.value?.control_links ?? [],
)
const catalogDefaults = computed<Record<string, number>>(
  () => planDocument.value?.catalog_defaults ?? {},
)
const documentUnderlay = computed<Underlay | null>(() => planDocument.value?.underlay ?? null)
const underlayImageSize = ref<ImageSize | null>(null)
const pixelsPerInch = computed(() => (currentViewport.value?.zoom ?? 1) * BASE_PIXELS_PER_INCH)
const selectedWalls = computed(() => editorStore.selectedWalls)
const selectedOpenings = computed(() => editorStore.selectedOpenings)
const selectedStairs = computed(() => editorStore.selectedStairs)
const selectedLabels = computed(() => editorStore.selectedLabels)
const selectedDimensions = computed(() => editorStore.selectedDimensions)
const selectedDevices = computed(() => editorStore.selectedDevices)
const selectedWires = computed(() => editorStore.selectedWires)
const deviceArmedType = ref<DeviceType | null>(null)
/** The switch a control link is being armed from (pick-target mode, spec D6), else null. */
const armedControlLinkSwitchId = ref<string | null>(null)
/** When set, asks the side panel to switch tabs (e.g. wire tool opens Circuits, §6.1). */
const requestedTab = ref<'inspector' | 'circuits' | 'layers' | null>(null)
/** Whether the export options modal is open (spec X4). */
const showExportDialog = ref(false)
/** Whether the keyboard-shortcut reference overlay is open (spec §6, '?'). */
const showShortcuts = ref(false)

/** Circuit ids currently shown on the canvas — the export dialog's default selection. */
const visibleCircuitIds = computed<string[]>(() =>
  documentCircuits.value
    .filter((circuit) => layersStore.isCircuitWiresVisible(circuit.id))
    .map((circuit) => circuit.id),
)

/** The active circuit's colour and name, echoed in the status bar while wiring (spec §6.1). */
const activeCircuit = computed<Circuit | null>(
  () =>
    documentCircuits.value.find((circuit) => circuit.id === editorStore.activeCircuitId) ?? null,
)

/**
 * Devices kept full-colour under circuit isolation (spec C5): the isolated
 * circuit's connected devices plus every panel. `null` = no isolation.
 */
const isolationHighlightIds = computed<ReadonlySet<string> | null>(() => {
  const isolated = editorStore.isolatedCircuitId
  if (isolated === null) return null
  const ids = new Set<string>()
  const load = validation.value.circuits.find((circuit) => circuit.circuit_id === isolated)
  for (const id of load?.connected_device_ids ?? []) ids.add(id)
  for (const device of documentDevices.value) {
    if (device.type === 'panel') ids.add(device.id)
  }
  return ids
})

const snapSettings = useSnapSettings()
const { grid: snapGrid, angle: snapAngle, walls: snapWalls } = snapSettings

const snapping = useSnapping({
  walls: documentWalls,
  pixelsPerInch,
  settings: snapSettings,
})

const wallTool = useWallTool({
  snapping,
  commit: (wall) => editorStore.mutate({ type: 'addWall', wall }),
})
const {
  preview: wallPreview,
  inputBuffer: wallInputBuffer,
  reference: wallReference,
  thicknessIn: wallThicknessIn,
  isDrawing: wallDrawing,
} = wallTool

const selectTool = useSelectTool({
  store: editorStore,
  walls: documentWalls,
  openings: documentOpenings,
  stairs: documentStairs,
  labels: documentLabels,
  dimensions: documentDimensions,
  devices: documentDevices,
  wires: documentWires,
  isCircuitWiresVisible: (circuitId) => layersStore.isCircuitWiresVisible(circuitId),
  underlay: documentUnderlay,
  underlayImageSize,
  pixelsPerInch,
  snapSettings,
})
const { preview: selectPreview, inputBuffer: selectInputBuffer } = selectTool

const wireTool = useWireTool({
  activeCircuitId: computed({
    get: () => editorStore.activeCircuitId,
    set: (value) => editorStore.setActiveCircuit(value),
  }),
  circuits: documentCircuits,
  devices: documentDevices,
  walls: documentWalls,
  commit: (wire) => editorStore.mutate({ type: 'addWire', wire }),
  onRequireCircuit: () => {
    requestedTab.value = null
    void nextTick(() => {
      requestedTab.value = 'circuits'
    })
  },
})

const deviceTool = useDeviceTool({
  armedType: deviceArmedType,
  walls: documentWalls,
  pixelsPerInch,
  snapSettings,
  commit: (device) => editorStore.mutate({ type: 'addDevice', device }),
})

const calibrateTool = useCalibrateTool({
  underlay: documentUnderlay,
  commit: (underlay) => editorStore.mutate({ type: 'setUnderlay', underlay }),
  onApplied: () => {
    activeTool.value = 'select'
  },
})
const { preview: calibratePreview, inputBuffer: calibrateInputBuffer } = calibrateTool

const openingKind = computed<'door' | 'window'>(() =>
  activeTool.value === 'window' ? 'window' : 'door',
)
const openingTool = useOpeningTool({
  kind: openingKind,
  walls: documentWalls,
  pixelsPerInch,
  commit: (opening) => editorStore.mutate({ type: 'addOpening', opening }),
})

const stairsTool = useStairsTool({
  snapping,
  commit: (stairs) => editorStore.mutate({ type: 'addStairs', stairs }),
})

const dimensionTool = useDimensionTool({
  snapping,
  commit: (dimension) => editorStore.mutate({ type: 'addDimension', dimension }),
})

const statusInputBuffer = computed(() => {
  if (activeTool.value === 'wall') return wallInputBuffer.value
  if (activeTool.value === 'select') return selectInputBuffer.value
  if (activeTool.value === 'calibrate') return calibrateInputBuffer.value
  if (activeTool.value === 'device') return deviceTool.inputBuffer.value
  return ''
})

const overlayFlashes = computed(() =>
  selectPreview.value.lockFlash ? [selectPreview.value.lockFlash] : [],
)

const openingPreview = computed(() =>
  activeTool.value === 'door' || activeTool.value === 'window' ? openingTool.preview.value : null,
)
const stairsPreview = computed(() =>
  activeTool.value === 'stairs' ? stairsTool.preview.value : null,
)
const dimensionPreview = computed(() =>
  activeTool.value === 'dimension' ? dimensionTool.preview.value : null,
)
const devicePreview = computed(() =>
  activeTool.value === 'device' ? deviceTool.preview.value : null,
)
const deviceChips = computed(() => (activeTool.value === 'device' ? deviceTool.chips.value : []))

function deviceCenterById(deviceId: string | null): Point | null {
  if (!deviceId) return null
  const device = documentDevices.value.find((candidate) => candidate.id === deviceId)
  return device ? (deviceWorldPlacement(device, documentWalls.value)?.position ?? null) : null
}

const wirePreview = computed(() => (activeTool.value === 'wire' ? wireTool.preview.value : null))
const wireSourceCenter = computed(() =>
  activeTool.value === 'wire' ? deviceCenterById(wireTool.sourceId.value) : null,
)
const wireHoverCenter = computed(() =>
  activeTool.value === 'wire' ? deviceCenterById(wireTool.hoveredId.value) : null,
)
const controlLinkArmedCenter = computed(() => deviceCenterById(armedControlLinkSwitchId.value))
const activeCalibratePreview = computed(() =>
  activeTool.value === 'calibrate' ? calibratePreview.value : null,
)

async function load(): Promise<void> {
  loadState.value = { status: 'loading' }
  try {
    const loaded = await editorStore.loadPlan(planId.value)
    initialViewport.value = loaded.document.viewport
    currentViewport.value = loaded.document.viewport
    loadState.value = { status: 'ready' }
  } catch (error) {
    loadState.value = {
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to load the plan',
    }
  }
}

function handleViewportChange(viewport: Viewport): void {
  currentViewport.value = viewport
  editorStore.mutate({ type: 'setViewport', viewport })
}

async function handleRename(name: string): Promise<void> {
  pageError.value = null
  try {
    await editorStore.renameCurrentPlan(name)
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : 'Failed to rename the plan'
  }
}

function handleCursorMove(point: Point | null): void {
  cursorWorld.value = point
  wallTool.setCursor(point)
  openingTool.setCursor(point)
  stairsTool.setCursor(point)
  dimensionTool.setCursor(point)
  deviceTool.setCursor(point)
  wireTool.setCursor(point)
  if (point && activeTool.value === 'select') selectTool.onPointerMove(point)
  if (activeTool.value === 'calibrate') calibrateTool.setCursor(point)
}

function placeLabel(point: Point): void {
  const label: Label = {
    id: crypto.randomUUID(),
    position: { ...point },
    text: DEFAULT_LABEL_TEXT,
    size_in: DEFAULT_LABEL_SIZE_IN,
  }
  editorStore.mutate({ type: 'addLabel', label })
  editorStore.select([{ kind: 'label', id: label.id }])
}

/** Topmost device under a world point (hit-tests the pictogram box). */
function deviceAtPoint(point: Point): Device | null {
  const list = documentDevices.value
  for (let i = list.length - 1; i >= 0; i--) {
    const placement = deviceWorldPlacement(list[i], documentWalls.value)
    if (placement && pointInPolygon(point, placement.bounds)) return list[i]
  }
  return null
}

/** Creates a control link from the armed switch to the picked device (spec D6). */
function pickControlLinkTarget(point: Point): void {
  const switchId = armedControlLinkSwitchId.value
  if (!switchId) return
  const target = deviceAtPoint(point)
  if (!target || target.id === switchId) return
  const switchDevice = documentDevices.value.find((device) => device.id === switchId)
  if (!switchDevice) {
    armedControlLinkSwitchId.value = null
    return
  }
  editorStore.mutate({
    type: 'addControlLink',
    link: {
      id: crypto.randomUUID(),
      switch_id: switchId,
      target_id: target.id,
      kind: controlLinkKind(switchDevice.type, target.type),
    },
  })
  armedControlLinkSwitchId.value = null
}

function handleCanvasPress(point: Point, modifiers: { shift: boolean; alt: boolean }): void {
  if (armedControlLinkSwitchId.value) {
    pickControlLinkTarget(point)
    return
  }
  switch (activeTool.value) {
    case 'wall':
      wallTool.onClick(point)
      break
    case 'select':
      selectTool.onPointerDown(point, modifiers)
      break
    case 'door':
    case 'window':
      openingTool.onClick(point)
      break
    case 'stairs':
      stairsTool.onPress(point)
      break
    case 'label':
      placeLabel(point)
      break
    case 'dimension':
      dimensionTool.onClick(point)
      break
    case 'device':
      deviceTool.onClick(point)
      break
    case 'wire':
      wireTool.onClick(point)
      break
    case 'calibrate':
      calibrateTool.onClick(point)
      break
    default:
      break
  }
}

function handleCanvasRelease(point: Point): void {
  if (activeTool.value === 'select') selectTool.onPointerUp(point)
  else if (activeTool.value === 'stairs') stairsTool.onRelease(point)
}

function handleCanvasDoubleClick(): void {
  if (activeTool.value === 'wall') wallTool.onDoubleClick()
}

function handleUpdateWall(wall: Wall): void {
  editorStore.mutate({ type: 'updateWall', wallId: wall.id, wall })
}

function handleUpdateOpening(opening: Opening): void {
  editorStore.mutate({ type: 'updateOpening', openingId: opening.id, opening })
}

function handleUpdateStairs(stairs: Stairs): void {
  editorStore.mutate({ type: 'updateStairs', stairsId: stairs.id, stairs })
}

function handleUpdateLabel(label: Label): void {
  editorStore.mutate({ type: 'updateLabel', labelId: label.id, label })
}

function handleUpdateDimension(dimension: Dimension): void {
  editorStore.mutate({ type: 'updateDimension', dimensionId: dimension.id, dimension })
}

function handleUpdateDevice(device: Device): void {
  editorStore.mutate({ type: 'updateDevice', deviceId: device.id, device })
}

function handleBulkUpdateDevices(devices: Device[]): void {
  editorStore.beginTransaction()
  for (const device of devices) {
    editorStore.mutate({ type: 'updateDevice', deviceId: device.id, device })
  }
  editorStore.commitTransaction()
}

function handleUpdateWire(wire: Wire): void {
  editorStore.mutate({ type: 'updateWire', wireId: wire.id, wire })
}

function handleArmControlLink(switchId: string): void {
  armedControlLinkSwitchId.value = armedControlLinkSwitchId.value === switchId ? null : switchId
}

function handleRemoveControlLink(linkId: string): void {
  editorStore.mutate({ type: 'removeControlLink', linkId })
}

function handleArmDevice(type: DeviceType): void {
  deviceArmedType.value = type
}

function handleUpdateUnderlay(underlay: Underlay): void {
  editorStore.mutate({ type: 'setUnderlay', underlay })
}

function handleRemoveUnderlay(): void {
  editorStore.mutate({ type: 'setUnderlay', underlay: null })
}

function handleRecalibrate(): void {
  if (documentUnderlay.value) activeTool.value = 'calibrate'
}

function handleDeleteSelection(): void {
  editorStore.deleteSelection()
}

function handleFlashSegments(wallId: string, segments: number[]): void {
  selectTool.flashLock(wallId, segments)
}

function toggleSnap(id: SnapToggleId): void {
  snapSettings[id].value = !snapSettings[id].value
}

function handleHistoryKey(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false
  const key = event.key.toLowerCase()
  if (key === 'z') {
    if (event.shiftKey) editorStore.redo()
    else editorStore.undo()
    return true
  }
  if (key === 'y' && !event.shiftKey) {
    editorStore.redo()
    return true
  }
  return false
}

function handleSelectToolKey(event: KeyboardEvent): boolean {
  if (selectTool.handleKey(event.key)) return true
  if ((event.key === 'Delete' || event.key === 'Backspace') && !selectTool.isDragging.value) {
    if (editorStore.selection.size === 0) return false
    editorStore.deleteSelection()
    return true
  }
  const nudge = ARROW_NUDGES[event.key]
  if (nudge) return selectTool.nudge(nudge.dx, nudge.dy, event.shiftKey)
  return false
}

function handleActiveToolKey(event: KeyboardEvent): boolean {
  switch (activeTool.value) {
    case 'wall':
      return wallTool.handleKey(event.key)
    case 'select':
      return handleSelectToolKey(event)
    case 'stairs':
      return stairsTool.handleKey(event.key)
    case 'dimension':
      return dimensionTool.handleKey(event.key)
    case 'device':
      if (deviceTool.handleKey(event.key)) return true
      if (event.key === 'Escape') {
        activeTool.value = 'select'
        return true
      }
      return false
    case 'wire':
      if (wireTool.handleKey(event.key)) return true
      if (event.key === 'Escape') {
        activeTool.value = 'select'
        return true
      }
      return false
    case 'calibrate':
      return calibrateTool.handleKey(event.key)
    default:
      return false
  }
}

/** Clipboard shortcuts for devices (spec D3): Ctrl/Cmd+C / +V / +D. */
function handleClipboardKey(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false
  const key = event.key.toLowerCase()
  if (key === 'c') {
    editorStore.copySelection()
    return true
  }
  if (key === 'v') {
    editorStore.pasteClipboard()
    return true
  }
  if (key === 'd') {
    editorStore.duplicateSelection()
    return true
  }
  return false
}

function onWindowKeyDown(event: KeyboardEvent): void {
  if (isTypingTarget(event.target)) return
  if (event.key === '?') {
    showShortcuts.value = !showShortcuts.value
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (event.key === 'Escape' && armedControlLinkSwitchId.value) {
    armedControlLinkSwitchId.value = null
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (handleHistoryKey(event)) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (handleClipboardKey(event)) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (event.ctrlKey || event.metaKey) return
  if (event.altKey && event.key !== 'Alt') return
  if (handleActiveToolKey(event)) {
    event.preventDefault()
    event.stopPropagation()
  }
}

function onWindowKeyUp(event: KeyboardEvent): void {
  if (event.key === 'Alt') setAltEverywhere(false)
}

function onWindowBlur(): void {
  setAltEverywhere(false)
}

function setAltEverywhere(held: boolean): void {
  wallTool.setAlt(held)
  selectTool.setAlt(held)
  stairsTool.setAlt(held)
  dimensionTool.setAlt(held)
}

useToolShortcuts(
  TOOLS,
  (id) => {
    activeTool.value = id
  },
  {
    suppress: (event) =>
      (activeTool.value === 'wall' &&
        (wallDrawing.value || wallInputBuffer.value !== '') &&
        isBufferKey(event.key)) ||
      (activeTool.value === 'select' &&
        (selectTool.isDragging.value || selectInputBuffer.value !== '') &&
        isBufferKey(event.key)) ||
      (activeTool.value === 'calibrate' &&
        calibrateTool.isAwaitingLength.value &&
        isBufferKey(event.key)) ||
      (activeTool.value === 'device' && deviceArmedType.value !== null && isBufferKey(event.key)),
  },
)

onMounted(() => {
  void load()
  // Capture phase so the active tool sees keys before the canvas pan handler
  // and the tool shortcuts, and can claim them with stopPropagation.
  window.addEventListener('keydown', onWindowKeyDown, true)
  window.addEventListener('keyup', onWindowKeyUp)
  window.addEventListener('blur', onWindowBlur)
})

watch(planId, (id, previous) => {
  if (id && id !== previous) void load()
})

watch(
  () => documentUnderlay.value?.image_ref ?? null,
  async (imageRef) => {
    if (!imageRef) {
      underlayImageSize.value = null
      return
    }
    try {
      underlayImageSize.value = await loadImageSize(assetUrl(imageRef))
    } catch {
      underlayImageSize.value = null
    }
  },
  { immediate: true },
)

watch(activeTool, (tool, previous) => {
  if (previous === 'wall' && tool !== 'wall') wallTool.deactivate()
  if (previous === 'select' && tool !== 'select') selectTool.deactivate()
  if ((previous === 'door' || previous === 'window') && tool !== 'door' && tool !== 'window') {
    openingTool.deactivate()
  }
  if (previous === 'stairs' && tool !== 'stairs') stairsTool.deactivate()
  if (previous === 'dimension' && tool !== 'dimension') dimensionTool.deactivate()
  if (previous === 'device' && tool !== 'device') {
    deviceTool.deactivate()
    deviceArmedType.value = null
  }
  if (tool === 'device' && previous !== 'device') deviceArmedType.value = null
  if (previous === 'wire' && tool !== 'wire') wireTool.deactivate()
  if (tool === 'wire' && previous !== 'wire' && editorStore.activeCircuitId === null) {
    requestedTab.value = null
    void nextTick(() => {
      requestedTab.value = 'circuits'
    })
  }
  if (previous === 'calibrate' && tool !== 'calibrate') calibrateTool.deactivate()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeyDown, true)
  window.removeEventListener('keyup', onWindowKeyUp)
  window.removeEventListener('blur', onWindowBlur)
  void editorStore.flushPendingSave()
})
</script>

<template>
  <div class="bg-surface text-ink flex h-screen flex-col overflow-hidden">
    <EditorTopBar
      :plan-name="plan?.name ?? 'Untitled'"
      :save-state="saveState"
      :save-error="saveError"
      :zoom-percent="zoomPercent"
      @rename="handleRename"
      @zoom-fit="canvas?.zoomToFit()"
      @zoom-reset="canvas?.zoomTo100()"
      @export="showExportDialog = true"
    />

    <div class="flex min-h-0 flex-1">
      <ToolRail :tools="TOOLS" :active-tool="activeTool" @select="activeTool = $event" />

      <main class="relative min-w-0 flex-1" aria-label="Canvas">
        <ViewportCanvas
          v-if="loadState.status === 'ready' && initialViewport"
          ref="canvas"
          :initial-viewport="initialViewport"
          @viewport-change="handleViewportChange"
          @cursor-move="handleCursorMove"
          @canvas-press="handleCanvasPress"
          @canvas-release="handleCanvasRelease"
          @canvas-double-click="handleCanvasDoubleClick"
        >
          <template #underlay="{ hairline }">
            <UnderlayLayer :hairline="hairline" :size="underlayImageSize" />
          </template>
          <template #default="{ hairline }">
            <StairsLayer :hairline="hairline" :preview="stairsPreview" />
            <WallsLayer :hairline="hairline" />
            <OpeningsLayer :hairline="hairline" :preview="openingPreview" />
            <ControlLinksLayer
              :hairline="hairline"
              :armed-center="controlLinkArmedCenter"
              :cursor="cursorWorld"
            />
            <WiresLayer
              :hairline="hairline"
              :preview="wirePreview"
              :hover-center="wireHoverCenter"
              :source-center="wireSourceCenter"
            />
            <DevicesLayer
              :hairline="hairline"
              :pixels-per-inch="pixelsPerInch"
              :preview="devicePreview"
              :highlight-device-ids="isolationHighlightIds"
            />
            <LabelsLayer :hairline="hairline" />
            <DimensionsLayer :hairline="hairline" :preview="dimensionPreview" />
            <WallToolOverlay
              v-if="activeTool === 'wall' && wallPreview"
              :preview="wallPreview"
              :hairline="hairline"
            />
            <SelectionOverlay
              v-if="activeTool === 'select'"
              :preview="selectPreview"
              :flashes="overlayFlashes"
              :hairline="hairline"
            />
            <CalibrateOverlay
              v-if="activeTool === 'calibrate' && activeCalibratePreview"
              :preview="activeCalibratePreview"
              :hairline="hairline"
            />
            <DeviceToolOverlay
              v-if="activeTool === 'device'"
              :chips="deviceChips"
              :hairline="hairline"
            />
          </template>
        </ViewportCanvas>
        <div
          v-else-if="loadState.status === 'loading'"
          class="text-ink-muted flex h-full items-center justify-center text-sm"
        >
          Loading plan…
        </div>
        <div
          v-else-if="loadState.status === 'error'"
          class="flex h-full flex-col items-center justify-center gap-3"
          role="alert"
        >
          <p class="text-danger text-sm">{{ loadState.message }}</p>
          <button
            type="button"
            class="bg-accent hover:bg-accent-strong rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors"
            @click="load"
          >
            Retry
          </button>
        </div>

        <p
          v-if="pageError"
          role="alert"
          class="bg-danger-soft text-danger absolute top-2 left-1/2 -translate-x-1/2 rounded-md px-3 py-1.5 text-xs shadow-panel"
        >
          {{ pageError }}
        </p>
      </main>

      <EditorSidePanel
        :active-tool="activeTool"
        :wall-thickness-presets-in="thicknessPresetsIn"
        :wall-thickness-in="wallThicknessIn"
        :wall-reference="wallReference"
        :walls="documentWalls"
        :selected-walls="selectedWalls"
        :selected-openings="selectedOpenings"
        :selected-stairs="selectedStairs"
        :selected-labels="selectedLabels"
        :selected-dimensions="selectedDimensions"
        :selected-devices="selectedDevices"
        :selected-wires="selectedWires"
        :all-devices="documentDevices"
        :circuits="documentCircuits"
        :control-links="documentControlLinks"
        :armed-control-link-switch-id="armedControlLinkSwitchId"
        :requested-tab="requestedTab"
        :selected-underlay="editorStore.selectedUnderlay"
        :underlay-image-size="underlayImageSize"
        :device-armed-type="deviceArmedType"
        :catalog-defaults="catalogDefaults"
        @set-wall-thickness="wallTool.setThickness($event)"
        @set-wall-reference="wallTool.setReference($event)"
        @update-wall="handleUpdateWall"
        @update-opening="handleUpdateOpening"
        @update-stairs="handleUpdateStairs"
        @update-label="handleUpdateLabel"
        @update-dimension="handleUpdateDimension"
        @update-device="handleUpdateDevice"
        @bulk-update-devices="handleBulkUpdateDevices"
        @update-wire="handleUpdateWire"
        @arm-control-link="handleArmControlLink"
        @remove-control-link="handleRemoveControlLink"
        @arm-device="handleArmDevice"
        @update-underlay="handleUpdateUnderlay"
        @recalibrate="handleRecalibrate"
        @remove-underlay="handleRemoveUnderlay"
        @delete-selection="handleDeleteSelection"
        @flash-segments="handleFlashSegments"
      />
    </div>

    <EditorStatusBar
      :cursor="cursorWorld"
      :zoom-percent="zoomPercent"
      :snap-grid="snapGrid"
      :snap-angle="snapAngle"
      :snap-walls="snapWalls"
      :wall-reference="activeTool === 'wall' ? wallReference : null"
      :input-buffer="statusInputBuffer"
      :active-circuit-name="activeTool === 'wire' ? (activeCircuit?.name ?? null) : null"
      :active-circuit-color="activeTool === 'wire' ? (activeCircuit?.color ?? null) : null"
      @toggle-snap="toggleSnap"
      @show-shortcuts="showShortcuts = true"
    />

    <ExportDialog
      v-if="showExportDialog && planDocument"
      :plan-name="plan?.name ?? 'Untitled'"
      :document="planDocument"
      :circuits="documentCircuits"
      :underlay-image-size="underlayImageSize"
      :visible-circuit-ids="visibleCircuitIds"
      @close="showExportDialog = false"
    />

    <ShortcutOverlay v-if="showShortcuts" @close="showShortcuts = false" />
  </div>
</template>
