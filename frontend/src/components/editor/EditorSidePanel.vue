<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'

import CircuitsPanel from '@/components/editor/CircuitsPanel.vue'
import DeviceInspector from '@/components/editor/DeviceInspector.vue'
import DevicePicker from '@/components/editor/DevicePicker.vue'
import DimensionInspector from '@/components/editor/DimensionInspector.vue'
import LabelInspector from '@/components/editor/LabelInspector.vue'
import LayersPanel from '@/components/editor/LayersPanel.vue'
import OpeningInspector from '@/components/editor/OpeningInspector.vue'
import OpeningToolOptions from '@/components/editor/OpeningToolOptions.vue'
import PlanSettingsPanel from '@/components/editor/PlanSettingsPanel.vue'
import StairsInspector from '@/components/editor/StairsInspector.vue'
import StairsToolOptions from '@/components/editor/StairsToolOptions.vue'
import ToolPlacementHint from '@/components/editor/ToolPlacementHint.vue'
import UnderlayInspector from '@/components/editor/UnderlayInspector.vue'
import WallInspector from '@/components/editor/WallInspector.vue'
import WireInspector from '@/components/editor/WireInspector.vue'
import WallToolOptions from '@/components/editor/WallToolOptions.vue'
import type { ToolId } from '@/components/editor/tools'
import { useCircuitValidation } from '@/composables/useCircuitValidation'
import { DEVICE_CATALOG } from '@/devices/catalog'
import type { ElementKind } from '@/stores/editor'
import type {
  Circuit,
  ControlLink,
  Device,
  DeviceType,
  Dimension,
  Label,
  Opening,
  Stairs,
  Underlay,
  Wall,
  Wire,
} from '@/types/plan'
import type { WallReference } from '@/utils/geometry'
import type { ImageSize } from '@/utils/imageSize'

type TabId = 'inspector' | 'circuits' | 'layers'

interface TabDefinition {
  id: TabId
  label: string
  placeholder: string
}

const TABS: readonly TabDefinition[] = [
  {
    id: 'inspector',
    label: 'Inspector',
    placeholder: 'Select an element to edit its properties.',
  },
  {
    id: 'circuits',
    label: 'Circuits',
    placeholder: '',
  },
  {
    id: 'layers',
    label: 'Layers',
    placeholder: '',
  },
]

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
      'Wires draw on the active circuit — create or select one in the Circuits tab first.',
      'Click a source device, then a target device to connect them. The target becomes the next source, so outlets daisy-chain. Esc ends the chain.',
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
  /** Plan metadata shown in the plan-settings view (spec §5.9 tier 2/§6.1). */
  planName: string
  planDescription: string
  /** The document's precision override; `null` means the 1/8" default (spec §5.9 tier 2). */
  displayPrecisionIn: number | null
  wallThicknessPresetsIn: readonly number[]
  wallThicknessIn: number
  wallReference: WallReference
  /** Live door/window tool options while those tools are armed (specs S4/S5/E8). */
  openingWidthIn: number
  openingHinge: 'left' | 'right'
  openingSwing: 'in' | 'out'
  /** Live stairs tool options while the stairs tool is armed (specs S6/E8). */
  stairsWidthIn: number
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
  /** When set, forces the panel to a tab (e.g. wire tool auto-opens Circuits, §6.1). */
  requestedTab: TabId | null
  /** The underlay when it is the selected element, else null (spec U3 inspector). */
  selectedUnderlay: Underlay | null
  /** Natural pixel size of the underlay image, for centre-anchored rotation. */
  underlayImageSize: ImageSize | null
  /** The armed device type while the Device tool is active, else null (spec §6.1). */
  deviceArmedType: DeviceType | null
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
  'set-opening-width': [widthIn: number]
  'set-opening-hinge': [hinge: 'left' | 'right']
  'set-opening-swing': [swing: 'in' | 'out']
  'set-stairs-width': [widthIn: number]
  'set-stairs-direction': [direction: 'up' | 'down']
  'update-wall': [wall: Wall]
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
  'update-underlay': [underlay: Underlay]
  recalibrate: []
  'remove-underlay': []
  'delete-selection': []
  'flash-segments': [wallId: string, segments: number[]]
}>()

const activeTabId = ref<TabId>('inspector')

const { warningCount } = useCircuitValidation()

watch(
  () => props.requestedTab,
  (tab) => {
    if (tab) activeTabId.value = tab
  },
)

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

const showDevicePicker = computed(
  () => props.activeTool === 'device' && props.deviceArmedType === null,
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
    showDevicePicker.value ||
    armedDeviceHint.value !== null ||
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

const inspectedUnderlay = computed<Underlay | null>(() =>
  toolInspects('underlay') && soloSelection.value && props.selectedUnderlay
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

const activePlaceholder = computed(
  () => TABS.find((tab) => tab.id === activeTabId.value)?.placeholder ?? '',
)
</script>

<template>
  <aside
    aria-label="Editor panels"
    class="border-line bg-surface flex w-72 shrink-0 flex-col border-l"
  >
    <div role="tablist" aria-label="Panel tabs" class="border-line flex border-b">
      <button
        v-for="tab in TABS"
        :id="`tab-${tab.id}`"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="tab.id === activeTabId"
        :aria-controls="`panel-${tab.id}`"
        class="flex-1 border-b-2 px-2 py-2 text-xs font-medium transition-colors"
        :class="
          tab.id === activeTabId
            ? 'border-accent text-accent'
            : 'border-transparent text-ink-muted hover:text-ink'
        "
        @click="activeTabId = tab.id"
      >
        <span class="inline-flex items-center gap-1">
          {{ tab.label }}
          <span
            v-if="tab.id === 'circuits' && warningCount > 0"
            class="bg-amber-500 inline-flex min-w-[14px] items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
            :aria-label="`${warningCount} circuits over 80%`"
            title="Circuits over 80%"
          >
            {{ warningCount }}
          </span>
        </span>
      </button>
    </div>
    <div
      :id="`panel-${activeTabId}`"
      role="tabpanel"
      :aria-labelledby="`tab-${activeTabId}`"
      class="flex-1 overflow-y-auto p-4"
    >
      <CircuitsPanel v-if="activeTabId === 'circuits'" />
      <LayersPanel
        v-else-if="activeTabId === 'layers'"
        :underlay-image-size="underlayImageSize"
        @recalibrate="emit('recalibrate')"
      />
      <template v-else>
        <!-- Tool options/hint on top while a placement tool is armed (spec E8). -->
        <WallToolOptions
          v-if="showWallOptions"
          :presets-in="wallThicknessPresetsIn"
          :thickness-in="wallThicknessIn"
          :reference="wallReference"
          @set-thickness="emit('set-wall-thickness', $event)"
          @set-reference="emit('set-wall-reference', $event)"
        />
        <template v-else-if="showOpeningOptions">
          <OpeningToolOptions
            :kind="openingKind"
            :width-in="openingWidthIn"
            :hinge="openingHinge"
            :swing="openingSwing"
            @set-width="emit('set-opening-width', $event)"
            @set-hinge="emit('set-opening-hinge', $event)"
            @set-swing="emit('set-opening-swing', $event)"
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
            :direction="stairsDirection"
            @set-width="emit('set-stairs-width', $event)"
            @set-direction="emit('set-stairs-direction', $event)"
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
        <ToolPlacementHint
          v-else-if="armedDeviceHint"
          :title="armedDeviceHint.title"
          :lines="armedDeviceHint.lines"
        />
        <ToolPlacementHint
          v-else-if="activeHint"
          :title="activeHint.title"
          :lines="activeHint.lines"
        />

        <!-- The selection's inspector below: any selection under Select, the
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
          <UnderlayInspector
            v-else-if="inspectedUnderlay"
            :underlay="inspectedUnderlay"
            :image-size="underlayImageSize"
            @update-underlay="emit('update-underlay', $event)"
            @recalibrate="emit('recalibrate')"
            @remove-underlay="emit('remove-underlay')"
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
        <!-- Nothing selected under the Select tool: the plan-settings view (spec §6.1/§5.9). -->
        <PlanSettingsPanel
          v-else-if="activeTool === 'select'"
          :plan-name="planName"
          :plan-description="planDescription"
          :thickness-presets-in="wallThicknessPresetsIn"
          :display-precision-in="displayPrecisionIn"
          @rename="emit('rename', $event)"
          @update-description="emit('update-description', $event)"
          @set-thickness-presets="emit('set-thickness-presets', $event)"
          @set-display-precision="emit('set-display-precision', $event)"
        />
        <p
          v-else-if="!hasToolSection"
          class="text-ink-muted mt-4 text-center text-xs leading-relaxed"
        >
          {{ activePlaceholder }}
        </p>
      </template>
    </div>
  </aside>
</template>
