<script setup lang="ts">
import { computed } from 'vue'

import DevicePictogram from '@/components/editor/DevicePictogram.vue'
import { isSourceType } from '@/devices/catalog'
import { pictogramSymbolId } from '@/devices/pictograms'
import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type { Circuit, Device } from '@/types/plan'
import { deviceCircuitColor } from '@/utils/circuitMembership'
import { DEVICE_NOMINAL_IN, deviceScreenScale, deviceWorldPlacement } from '@/utils/geometry'

const props = defineProps<{
  /** World-unit stroke width rendering as ~1px on screen. */
  hairline: number
  /** Current screen pixels per world inch, for the min-size clamp (spec D4). */
  pixelsPerInch: number
  /** Transient device previewed by the device tool, if any. */
  preview?: Device | null
  /**
   * When circuit isolation is active (spec C5), the device ids that stay full
   * colour; every other device dims. `null` means no isolation.
   */
  highlightDeviceIds?: ReadonlySet<string> | null
  /**
   * Every device's circuits in document order, for colour and visibility
   * (spec C2/C6). Passed in rather than derived here: validation is one BFS
   * over the whole document and the host already computes it.
   */
  membership: ReadonlyMap<string, readonly Circuit[]>
}>()

const editorStore = useEditorStore()
const layersStore = useLayersStore()

const HALF = DEVICE_NOMINAL_IN / 2

/**
 * How a device is inked. Exactly one side applies: a theme colour class, or an
 * explicit circuit colour carried by the SVG `color` presentation attribute — a
 * per-circuit hex has no Tailwind token, and both the footprint rectangle and
 * every pictogram shape stroke with `currentColor`.
 */
interface DeviceTint {
  /** Theme colour class, absent when an explicit circuit colour applies. */
  className?: string
  /** Circuit colour, absent when the class governs. */
  color?: string
}

interface DeviceView {
  id: string
  href: string
  transform: string
  /** Polygon points of the true-size footprint rectangle, or `null` when symbolic. */
  footprint: string | null
  selected: boolean
  preview: boolean
  dimmed: boolean
  tint: DeviceTint
}

function isDimmed(device: Device, isPreview: boolean): boolean {
  if (isPreview || !props.highlightDeviceIds) return false
  return !props.highlightDeviceIds.has(device.id)
}

/**
 * Device colour precedence (spec C2/C5), resolved in this one place and
 * mirrored exactly by the SVG export (`svgExport.renderDevice`):
 *
 *   1. the placement preview ghost — accent;
 *   2. selected — the selection accent, which must keep winning so a selected
 *      device stays legible on top of any circuit colour;
 *   3. on a circuit — that circuit's colour, via `deviceCircuitColor` (sources
 *      stay ink; a device on several circuits takes the first in document order);
 *   4. otherwise — ink.
 *
 * Circuit-isolation dimming is orthogonal: it only lowers opacity, so a dimmed
 * device keeps its circuit colour instead of falling back to ink.
 */
function resolveTint(device: Device, selected: boolean, isPreview: boolean): DeviceTint {
  if (isPreview) return { className: 'text-accent' }
  if (selected) return { className: 'text-accent-strong' }
  const color = deviceCircuitColor(device, props.membership)
  return color === null ? { className: 'text-ink' } : { color }
}

/**
 * Whether per-circuit device visibility hides this device (spec C6): every
 * circuit it belongs to has its devices hidden. A device on no circuit is never
 * hidden this way, and sources always render — the panel and the inter-floor
 * feeds belong to every circuit, so hiding them would only confuse.
 */
function isCircuitDeviceHidden(device: Device): boolean {
  if (isSourceType(device.type)) return false
  const circuits = props.membership.get(device.id)
  if (circuits === undefined) return false
  return circuits.every((circuit) => !layersStore.isCircuitAxisVisible(circuit.id, 'devices'))
}

function buildView(device: Device, selected: boolean, isPreview: boolean): DeviceView | null {
  const walls = editorStore.document?.walls ?? []
  const placement = deviceWorldPlacement(device, walls)
  if (!placement) return null
  const dimmed = isDimmed(device, isPreview)
  // The footprint rectangle is real geometry and stays at true size; only the
  // glyph inscribed in it takes the min-screen-size clamp (spec D4). The
  // trailing translate applies the baseline offset INSIDE that scale, so it
  // tracks the clamp instead of sinking into the wall as `scale` grows.
  const scale = deviceScreenScale(props.pixelsPerInch)
  const { glyphAnchor, glyphOffsetIn, angleDeg } = placement
  return {
    id: device.id,
    href: `#${pictogramSymbolId(device.type)}`,
    transform: `translate(${glyphAnchor.x} ${glyphAnchor.y}) rotate(${angleDeg}) scale(${scale}) translate(0 ${-glyphOffsetIn})`,
    footprint: placement.footprintRect?.map((point) => `${point.x},${point.y}`).join(' ') ?? null,
    selected,
    preview: isPreview,
    dimmed,
    tint: resolveTint(device, selected, isPreview),
  }
}

function viewOpacity(view: DeviceView): number {
  if (view.preview) return 0.7
  return view.dimmed ? 0.25 : 1
}

const deviceViews = computed<DeviceView[]>(() => {
  void editorStore.documentVersion
  const views: DeviceView[] = []
  for (const device of editorStore.document?.devices ?? []) {
    if (isCircuitDeviceHidden(device)) continue
    const view = buildView(device, editorStore.isSelected({ kind: 'device', id: device.id }), false)
    if (view) views.push(view)
  }
  if (props.preview) {
    const view = buildView(props.preview, false, true)
    if (view) views.push(view)
  }
  return views
})
</script>

<template>
  <g v-if="layersStore.devicesVisible" aria-label="Devices">
    <DevicePictogram />
    <template v-for="view in deviceViews" :key="view.id">
      <polygon
        v-if="view.footprint !== null"
        :points="view.footprint"
        fill="none"
        stroke="currentColor"
        :class="view.tint.className"
        :color="view.tint.color"
        :stroke-width="(view.selected ? 1.8 : 1.2) * hairline"
        :opacity="viewOpacity(view)"
      />
      <use
        :href="view.href"
        :x="-HALF"
        :y="-HALF"
        :width="DEVICE_NOMINAL_IN"
        :height="DEVICE_NOMINAL_IN"
        :transform="view.transform"
        :class="view.tint.className"
        :color="view.tint.color"
        :opacity="viewOpacity(view)"
      />
    </template>
  </g>
</template>
