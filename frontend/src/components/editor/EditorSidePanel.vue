<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'
import { computed } from 'vue'

import CircuitsPanel from '@/components/editor/CircuitsPanel.vue'
import DeviceInspector from '@/components/editor/DeviceInspector.vue'
import DevicePicker from '@/components/editor/DevicePicker.vue'
import DeviceToolOptions from '@/components/editor/DeviceToolOptions.vue'
import DimensionInspector from '@/components/editor/DimensionInspector.vue'
import InspectorOverviewPanel from '@/components/editor/InspectorOverviewPanel.vue'
import LabelInspector from '@/components/editor/LabelInspector.vue'
import OpeningInspector from '@/components/editor/OpeningInspector.vue'
import OpeningToolOptions from '@/components/editor/OpeningToolOptions.vue'
import StairsInspector from '@/components/editor/StairsInspector.vue'
import StairsToolOptions from '@/components/editor/StairsToolOptions.vue'
import StructureOverviewPanel from '@/components/editor/StructureOverviewPanel.vue'
import ToolPlacementHint from '@/components/editor/ToolPlacementHint.vue'
import UnderlayPanel from '@/components/editor/UnderlayPanel.vue'
import WallInspector from '@/components/editor/WallInspector.vue'
import WireInspector from '@/components/editor/WireInspector.vue'
import WallToolOptions from '@/components/editor/WallToolOptions.vue'
import type { ModeId, ToolId } from '@/components/editor/tools'
import type { DeviceDraft } from '@/composables/useDeviceTool'
import { DEVICE_CATALOG } from '@/devices/catalog'
import type { ElementKind } from '@/stores/editor'
import type {
  Circuit,
  ControlLink,
  Device,
  DeviceType,
  Dimension,
  DoorStyle,
  Label,
  Opening,
  Stairs,
  Underlay,
  Wall,
  Wire,
} from '@/types/plan'
import type { WallReference } from '@/utils/geometry'
import type { ImageSize } from '@/utils/imageSize'

/** Shown when a tool has neither options nor a selection to inspect (spec §6.1). */
const IDLE_PLACEHOLDER = 'Select an element to edit its properties.'

/** Minimal placement instructions shown while a placement tool is active (spec E1/E6). */
const TOOL_HINTS: Partial<Record<ToolId, { title: string; lines: string[] }>> = {
  door: {
    title: 'Door',
    lines: [
      'Hover a wall to preview the door, then click to place it — the options above apply to the ghost live.',
      'A placed door stays selected below for immediate tweaks; click an existing door to edit it instead of placing.',
    ],
  },
  window: {
    title: 'Window',
    lines: [
      'Hover a wall to preview the window, then click to place it — the width above applies to the ghost live.',
      'A placed window stays selected below for immediate tweaks; click an existing window to edit it instead of placing.',
    ],
  },
  stairs: {
    title: 'Stairs',
    lines: [
      'A ghost run follows the cursor — the options above apply to it live. Press to set the origin corner, drag along the run direction, release to place.',
      'Tab flips up/down at any time; while dragging, type a length then Enter to place the far end exactly.',
      'A placed run stays selected below for tweaks; clicking an existing run edits it. Esc cancels the drag.',
    ],
  },
  label: {
    title: 'Label',
    lines: [
      'Click anywhere to place a text label, then type its text below.',
      'Click an existing label to edit it instead of placing.',
    ],
  },
  dimension: {
    title: 'Dimension',
    lines: [
      'Click two points to measure between them — clicks snap to endpoints, midpoints, walls and the grid.',
      'A placed dimension stays selected below; click an existing one to edit it. Esc cancels the first point.',
    ],
  },
  wire: {
    title: 'Wire',
    lines: [
      'Wires draw on the active circuit — click a row in the list above to make it the target, or press 1–9 to switch while the tool is armed.',
      'Click a source device, then a target device to connect them. The target becomes the next source, so outlets daisy-chain. Enter or Esc ends the chain.',
    ],
  },
  calibrate: {
    title: 'Calibrate',
    lines: [
      'Click the two ends of something you know the real length of on the photo above — a 10′ wall, a door.',
      'Then type that length and press Enter: the underlay rescales around the first point. Esc cancels.',
    ],
  },
}

/**
 * Tools whose Inspector mirrors the whole selection (spec E2). Placement
 * tools instead show their options on top and only a selection of their own
 * kind below (spec E8).
 */
const SELECTION_MIRROR_TOOLS: ReadonlySet<ToolId> = new Set(['select', 'calibrate', 'measure'])

/** The selection kind each placement tool inspects under its options (spec E8). */
const TOOL_SELECTION_KINDS: Partial<Record<ToolId, ElementKind>> = {
  door: 'opening',
  window: 'opening',
  stairs: 'stairs',
  label: 'label',
  dimension: 'dimension',
  device: 'device',
}

const props = defineProps<{
  activeTool: ToolId
  /** The workspace mode, which picks the overview shown when nothing is armed (spec E10/§6.1). */
  activeMode: ModeId
  /** Plan metadata shown in the Inspector overview (spec §5.9 tier 2/§6.1). */
  planName: string
  planDescription: string
  /** The document's precision override; `null` means the 1/8" default (spec §5.9 tier 2). */
  displayPrecisionIn: number | null
  wallThicknessPresetsIn: readonly number[]
  wallThicknessIn: number
  wallReference: WallReference
  /** Colour the wall tool gives the next wall; null follows its role (spec S1f). */
  wallColor: string | null
  /** Live door/window tool options while those tools are armed (specs S4/S5/E8). */
  openingWidthIn: number
  /** Width presets for the current door/window kind, resolved from the document (spec §5.9 tier 2). */
  openingWidthPresetsIn: readonly number[]
  /** Leaf style the door tool places with (spec S4). */
  openingStyle: DoorStyle
  openingHinge: 'left' | 'right'
  openingSwing: 'in' | 'out'
  /** Live stairs tool options while the stairs tool is armed (specs S6/E8). */
  stairsWidthIn: number
  /** Stair-width presets, resolved from the document (spec §5.9 tier 2). */
  stairsWidthPresetsIn: readonly number[]
  stairsDirection: 'up' | 'down'
  /** All walls of the document (host lookup for opening inspection). */
  walls: readonly Wall[]
  /** Currently selected elements (spec E2: contextual properties panel). */
  selectedWalls: readonly Wall[]
  selectedOpenings: readonly Opening[]
  selectedStairs: readonly Stairs[]
  selectedLabels: readonly Label[]
  selectedDimensions: readonly Dimension[]
  selectedDevices: readonly Device[]
  selectedWires: readonly Wire[]
  /** All devices, for wire endpoint / control-link target labels (spec §5.6, D6). */
  allDevices: readonly Device[]
  /** All circuits, for the wire circuit-reassignment select (spec W2). */
  circuits: readonly Circuit[]
  /** All control links, for the switch Inspector's Controls section (spec D6). */
  controlLinks: readonly ControlLink[]
  /** The switch whose control link is being armed (pick-target mode), else null (spec D6). */
  armedControlLinkSwitchId: string | null
  /** The underlay when it is the selected element, else null (spec U3 inspector). */
  selectedUnderlay: Underlay | null
  /** Natural pixel size of the underlay image, for centre-anchored rotation. */
  underlayImageSize: ImageSize | null
  /** The armed device type while the Device tool is active, else null (spec §6.1). */
  deviceArmedType: DeviceType | null
  /** The armed type's draft applied to the next placed device (spec E8/§6.1). */
  deviceDraft: DeviceDraft
  /** Plan-level per-type default loads (spec §5.9 tier 2). */
  catalogDefaults: Record<string, number>
}>()

const emit = defineEmits<{
  rename: [name: string]
  'update-description': [description: string]
  'set-thickness-presets': [presetsIn: number[]]
  'set-display-precision': [precisionIn: number]
  'set-wall-thickness': [thicknessIn: number]
  'set-wall-reference': [reference: WallReference]
  'set-wall-color': [color: string | null]
  'set-opening-width': [widthIn: number]
  'set-opening-style': [style: DoorStyle]
  'set-opening-hinge': [hinge: 'left' | 'right']
  'set-opening-swing': [swing: 'in' | 'out']
  'add-opening-width-preset': [widthIn: number]
  'set-stairs-width': [widthIn: number]
  'set-stairs-direction': [direction: 'up' | 'down']
  'add-stairs-width-preset': [widthIn: number]
  'update-wall': [wall: Wall]
  /** Transient reference-side hover preview from the wall inspector (spec S1a). */
  'preview-wall': [wall: Wall | null]
  'update-opening': [opening: Opening]
  'update-stairs': [stairs: Stairs]
  'update-label': [label: Label]
  'update-dimension': [dimension: Dimension]
  'update-device': [device: Device]
  'bulk-update-devices': [devices: Device[]]
  'update-wire': [wire: Wire]
  'arm-control-link': [switchId: string]
  'remove-control-link': [linkId: string]
  'arm-device': [type: DeviceType]
  /** A field of the armed type's draft changed (spec E8/§6.1). */
  'update-device-draft': [patch: Partial<DeviceDraft>]
  /** Returns to the device picker — the same effect as Esc (spec §6.1). */
  'change-device': []
  recalibrate: []
  /** Opens the export options dialog from the Inspector overview (spec X4/§6.1). */
  export: []
  'delete-selection': []
  'flash-segments': [wallId: string, segments: number[]]
}>()

const selectionCount = computed(
  () =>
    props.selectedWalls.length +
    props.selectedOpenings.length +
    props.selectedStairs.length +
    props.selectedLabels.length +
    props.selectedDimensions.length +
    props.selectedDevices.length +
    props.selectedWires.length +
    (props.selectedUnderlay ? 1 : 0),
)

/** Whether the Inspector reflects selections of `kind` under the active tool (specs E2/E8). */
function toolInspects(kind: ElementKind): boolean {
  if (SELECTION_MIRROR_TOOLS.has(props.activeTool)) return true
  return TOOL_SELECTION_KINDS[props.activeTool] === kind
}

const showWallOptions = computed(() => props.activeTool === 'wall')

const showOpeningOptions = computed(
  () => props.activeTool === 'door' || props.activeTool === 'window',
)

const openingKind = computed<'door' | 'window'>(() =>
  props.activeTool === 'window' ? 'window' : 'door',
)

const showStairsOptions = computed(() => props.activeTool === 'stairs')

/** The Wire tool's options ARE the circuits list (spec W1/§6.1). */
const showCircuitOptions = computed(() => props.activeTool === 'wire')

/** The Calibrate tool's options are the underlay controls (spec §6.1). */
const showUnderlayOptions = computed(() => props.activeTool === 'calibrate')

const showDevicePicker = computed(
  () => props.activeTool === 'device' && props.deviceArmedType === null,
)

/** The armed type while the Device tool holds one, else null (spec E8/§6.1). */
const armedDeviceType = computed<DeviceType | null>(() =>
  props.activeTool === 'device' ? props.deviceArmedType : null,
)

const armedDeviceHint = computed(() => {
  if (props.activeTool !== 'device' || props.deviceArmedType === null) return null
  const entry = DEVICE_CATALOG[props.deviceArmedType]
  const place =
    entry.mount === 'wall'
      ? 'Click a wall to place it on the nearest face; the cursor side picks the face.'
      : 'Click anywhere to drop it (grid-snapped).'
  return {
    title: `Placing: ${entry.label}`,
    lines: [
      place,
      'Type a distance then Enter to set the offset exactly; Tab switches side. The tool stays armed for repeat placement — Esc changes device.',
      'A placed device stays selected below for tweaks; click an existing device to edit it.',
    ],
  }
})

const activeHint = computed(() => TOOL_HINTS[props.activeTool] ?? null)

/** Whether a tool options/hint block renders on top of the Inspector (spec E8). */
const hasToolSection = computed(
  () =>
    showWallOptions.value ||
    showOpeningOptions.value ||
    showStairsOptions.value ||
    showCircuitOptions.value ||
    showUnderlayOptions.value ||
    showDevicePicker.value ||
    armedDeviceType.value !== null ||
    activeHint.value !== null,
)

const soloSelection = computed(() => selectionCount.value === 1)

const inspectedWall = computed<Wall | null>(() =>
  toolInspects('wall') && soloSelection.value && props.selectedWalls.length === 1
    ? props.selectedWalls[0]
    : null,
)

const inspectedOpening = computed<Opening | null>(() => {
  if (!toolInspects('opening') || !soloSelection.value || props.selectedOpenings.length !== 1) {
    return null
  }
  const opening = props.selectedOpenings[0]
  // The door and window tools only inspect openings of their own kind (spec E8).
  if (props.activeTool === 'door' || props.activeTool === 'window') {
    return opening.kind === props.activeTool ? opening : null
  }
  return opening
})

const inspectedStairs = computed<Stairs | null>(() =>
  toolInspects('stairs') && soloSelection.value && props.selectedStairs.length === 1
    ? props.selectedStairs[0]
    : null,
)

const inspectedLabel = computed<Label | null>(() =>
  toolInspects('label') && soloSelection.value && props.selectedLabels.length === 1
    ? props.selectedLabels[0]
    : null,
)

const inspectedDimension = computed<Dimension | null>(() =>
  toolInspects('dimension') && soloSelection.value && props.selectedDimensions.length === 1
    ? props.selectedDimensions[0]
    : null,
)

/**
 * The selected underlay, inspected with the very same `UnderlayPanel` the
 * Calibrate tool shows as its options — so under Calibrate the panel renders
 * once, on top, and never twice.
 */
const inspectedUnderlay = computed<Underlay | null>(() =>
  !showUnderlayOptions.value && toolInspects('underlay') && soloSelection.value
    ? props.selectedUnderlay
    : null,
)

/** Pure device selection (one or many) — routed to the DeviceInspector. */
const inspectedDevices = computed<readonly Device[] | null>(() =>
  toolInspects('device') &&
  props.selectedDevices.length > 0 &&
  props.selectedDevices.length === selectionCount.value
    ? props.selectedDevices
    : null,
)

const inspectedWire = computed<Wire | null>(() =>
  toolInspects('wire') && soloSelection.value && props.selectedWires.length === 1
    ? props.selectedWires[0]
    : null,
)

const showMultiSummary = computed(
  () =>
    SELECTION_MIRROR_TOOLS.has(props.activeTool) &&
    selectionCount.value > 1 &&
    inspectedDevices.value === null &&
    inspectedWire.value === null,
)

/** Whether an element inspector (or the multi summary) renders below the tool section. */
const hasInspectedElement = computed(
  () =>
    inspectedWall.value !== null ||
    inspectedOpening.value !== null ||
    inspectedStairs.value !== null ||
    inspectedLabel.value !== null ||
    inspectedDimension.value !== null ||
    inspectedUnderlay.value !== null ||
    inspectedDevices.value !== null ||
    inspectedWire.value !== null ||
    showMultiSummary.value,
)

/**
 * The mode's home screen (spec §6.1): shown only under the Select tool with an
 * empty selection, so tool options and inspectors always win the panel.
 */
const showModeOverview = computed(() => props.activeTool === 'select' && !hasInspectedElement.value)
</script>

<template>
  <aside
    aria-label="Editor panel"
    class="border-line bg-surface shadow-panel rounded-card m-3 flex max-h-[calc(100%-3rem)] w-72 flex-col overflow-hidden border"
  >
    <div class="flex-1 overflow-y-auto p-4">
      <!-- 1. Tool options on top while a tool with options is armed (spec E8/§6.1). -->
      <WallToolOptions
        v-if="showWallOptions"
        :presets-in="wallThicknessPresetsIn"
        :thickness-in="wallThicknessIn"
        :reference="wallReference"
        :color="wallColor"
        @set-thickness="emit('set-wall-thickness', $event)"
        @set-reference="emit('set-wall-reference', $event)"
        @set-color="emit('set-wall-color', $event)"
      />
      <template v-else-if="showOpeningOptions">
        <OpeningToolOptions
          :kind="openingKind"
          :width-in="openingWidthIn"
          :presets-in="openingWidthPresetsIn"
          :door-style="openingStyle"
          :hinge="openingHinge"
          :swing="openingSwing"
          @set-width="emit('set-opening-width', $event)"
          @set-style="emit('set-opening-style', $event)"
          @set-hinge="emit('set-opening-hinge', $event)"
          @set-swing="emit('set-opening-swing', $event)"
          @add-width-preset="emit('add-opening-width-preset', $event)"
        />
        <ToolPlacementHint
          v-if="activeHint"
          class="mt-4"
          :title="activeHint.title"
          :lines="activeHint.lines"
        />
      </template>
      <template v-else-if="showStairsOptions">
        <StairsToolOptions
          :width-in="stairsWidthIn"
          :presets-in="stairsWidthPresetsIn"
          :direction="stairsDirection"
          @set-width="emit('set-stairs-width', $event)"
          @set-direction="emit('set-stairs-direction', $event)"
          @add-width-preset="emit('add-stairs-width-preset', $event)"
        />
        <ToolPlacementHint
          v-if="activeHint"
          class="mt-4"
          :title="activeHint.title"
          :lines="activeHint.lines"
        />
      </template>
      <!-- The Wire tool's options are the circuits list itself (spec W1/§6.1). -->
      <template v-else-if="showCircuitOptions">
        <CircuitsPanel />
        <ToolPlacementHint
          v-if="activeHint"
          class="mt-4"
          :title="activeHint.title"
          :lines="activeHint.lines"
        />
      </template>
      <!-- The Calibrate tool's options are the underlay controls (spec §6.1). -->
      <template v-else-if="showUnderlayOptions">
        <UnderlayPanel
          :underlay-image-size="underlayImageSize"
          @recalibrate="emit('recalibrate')"
        />
        <ToolPlacementHint
          v-if="activeHint"
          class="mt-4"
          :title="activeHint.title"
          :lines="activeHint.lines"
        />
      </template>
      <DevicePicker
        v-else-if="showDevicePicker"
        :armed-type="deviceArmedType"
        @pick="emit('arm-device', $event)"
      />
      <template v-else-if="armedDeviceType">
        <DeviceToolOptions
          :type="armedDeviceType"
          :draft="deviceDraft"
          :catalog-defaults="catalogDefaults"
          @update-draft="emit('update-device-draft', $event)"
          @change-device="emit('change-device')"
        />
        <ToolPlacementHint
          v-if="armedDeviceHint"
          class="mt-4"
          :title="armedDeviceHint.title"
          :lines="armedDeviceHint.lines"
        />
      </template>
      <ToolPlacementHint
        v-else-if="activeHint"
        :title="activeHint.title"
        :lines="activeHint.lines"
      />

      <!-- 2. The selection's inspector below: any selection under Select, the
           tool's own kind while a placement tool is armed (spec E8). -->
      <div
        v-if="hasInspectedElement"
        :class="hasToolSection ? 'border-line mt-4 border-t pt-4' : ''"
      >
        <WallInspector
          v-if="inspectedWall"
          :wall="inspectedWall"
          :thickness-presets-in="wallThicknessPresetsIn"
          @update-wall="emit('update-wall', $event)"
          @preview-wall="emit('preview-wall', $event)"
          @delete-wall="emit('delete-selection')"
          @flash-segments="emit('flash-segments', inspectedWall.id, $event)"
        />
        <OpeningInspector
          v-else-if="inspectedOpening"
          :opening="inspectedOpening"
          :walls="walls"
          @update-opening="emit('update-opening', $event)"
          @delete-opening="emit('delete-selection')"
        />
        <StairsInspector
          v-else-if="inspectedStairs"
          :stairs="inspectedStairs"
          @update-stairs="emit('update-stairs', $event)"
          @delete-stairs="emit('delete-selection')"
        />
        <LabelInspector
          v-else-if="inspectedLabel"
          :label="inspectedLabel"
          :autofocus="activeTool === 'label'"
          @update-label="emit('update-label', $event)"
          @delete-label="emit('delete-selection')"
        />
        <DimensionInspector
          v-else-if="inspectedDimension"
          :dimension="inspectedDimension"
          @update-dimension="emit('update-dimension', $event)"
          @delete-dimension="emit('delete-selection')"
        />
        <UnderlayPanel
          v-else-if="inspectedUnderlay"
          :underlay-image-size="underlayImageSize"
          @recalibrate="emit('recalibrate')"
        />
        <DeviceInspector
          v-else-if="inspectedDevices"
          :devices="inspectedDevices"
          :walls="walls"
          :catalog-defaults="catalogDefaults"
          :all-devices="allDevices"
          :control-links="controlLinks"
          :armed-control-link-switch-id="armedControlLinkSwitchId"
          @update-device="emit('update-device', $event)"
          @bulk-update-devices="emit('bulk-update-devices', $event)"
          @delete-selection="emit('delete-selection')"
          @arm-control-link="emit('arm-control-link', $event)"
          @remove-control-link="emit('remove-control-link', $event)"
        />
        <WireInspector
          v-else-if="inspectedWire"
          :wire="inspectedWire"
          :circuits="circuits"
          :devices="allDevices"
          :walls="walls"
          @update-wire="emit('update-wire', $event)"
          @delete-selection="emit('delete-selection')"
        />
        <section v-else-if="showMultiSummary" aria-label="Selection summary" class="text-xs">
          <h3 class="text-ink text-sm font-semibold">Selection</h3>
          <p class="text-ink-muted mt-1">{{ selectionCount }} elements selected.</p>
          <button
            type="button"
            class="border-danger/40 text-danger hover:bg-danger-soft mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
            @click="emit('delete-selection')"
          >
            <Trash2 :size="13" aria-hidden="true" />
            Delete selection
          </button>
        </section>
      </div>

      <!-- 3. The mode's overview, the panel's fallback home (spec §6.1). -->
      <template v-else-if="showModeOverview">
        <StructureOverviewPanel
          v-if="activeMode === 'structure'"
          :thickness-presets-in="wallThicknessPresetsIn"
          :underlay-image-size="underlayImageSize"
          @set-thickness-presets="emit('set-thickness-presets', $event)"
          @recalibrate="emit('recalibrate')"
        />
        <CircuitsPanel v-else-if="activeMode === 'electrical'" />
        <InspectorOverviewPanel
          v-else
          :plan-name="planName"
          :plan-description="planDescription"
          :display-precision-in="displayPrecisionIn"
          @rename="emit('rename', $event)"
          @update-description="emit('update-description', $event)"
          @set-display-precision="emit('set-display-precision', $event)"
          @export="emit('export')"
        />
      </template>
      <p
        v-else-if="!hasToolSection"
        class="text-ink-muted mt-4 text-center text-xs leading-relaxed"
      >
        {{ IDLE_PLACEHOLDER }}
      </p>
    </div>
  </aside>
</template>
