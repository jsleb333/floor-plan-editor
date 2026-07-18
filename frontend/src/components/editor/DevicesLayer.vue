<script setup lang="ts">
import { computed } from 'vue'

import DevicePictogram from '@/components/editor/DevicePictogram.vue'
import { pictogramSymbolId } from '@/devices/pictograms'
import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type { Device } from '@/types/plan'
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
}>()

const editorStore = useEditorStore()
const layersStore = useLayersStore()

const HALF = DEVICE_NOMINAL_IN / 2

interface DeviceView {
  id: string
  href: string
  transform: string
  baseboard: string | null
  selected: boolean
  preview: boolean
  dimmed: boolean
}

function isDimmed(device: Device, isPreview: boolean): boolean {
  if (isPreview || !props.highlightDeviceIds) return false
  return !props.highlightDeviceIds.has(device.id)
}

function buildView(device: Device, selected: boolean, isPreview: boolean): DeviceView | null {
  const walls = editorStore.document?.walls ?? []
  const placement = deviceWorldPlacement(device, walls)
  if (!placement) return null
  const dimmed = isDimmed(device, isPreview)
  if (placement.baseboardRect) {
    return {
      id: device.id,
      href: pictogramSymbolId(device.type),
      transform: '',
      baseboard: placement.baseboardRect.map((point) => `${point.x},${point.y}`).join(' '),
      selected,
      preview: isPreview,
      dimmed,
    }
  }
  const scale = deviceScreenScale(props.pixelsPerInch)
  return {
    id: device.id,
    href: `#${pictogramSymbolId(device.type)}`,
    transform: `translate(${placement.position.x} ${placement.position.y}) rotate(${placement.angleDeg}) scale(${scale})`,
    baseboard: null,
    selected,
    preview: isPreview,
    dimmed,
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
    const view = buildView(device, editorStore.isSelected({ kind: 'device', id: device.id }), false)
    if (view) views.push(view)
  }
  if (props.preview) {
    const view = buildView(props.preview, false, true)
    if (view) views.push(view)
  }
  return views
})

function colorClass(view: DeviceView): string {
  if (view.preview) return 'text-accent'
  return view.selected ? 'text-accent-strong' : 'text-ink'
}
</script>

<template>
  <g v-if="layersStore.devicesVisible" aria-label="Devices">
    <DevicePictogram />
    <template v-for="view in deviceViews" :key="view.id">
      <polygon
        v-if="view.baseboard !== null"
        :points="view.baseboard"
        fill="none"
        stroke="currentColor"
        :class="colorClass(view)"
        :stroke-width="(view.selected ? 1.8 : 1.2) * hairline"
        :opacity="viewOpacity(view)"
      />
      <use
        v-else
        :href="view.href"
        :x="-HALF"
        :y="-HALF"
        :width="DEVICE_NOMINAL_IN"
        :height="DEVICE_NOMINAL_IN"
        :transform="view.transform"
        :class="colorClass(view)"
        :opacity="viewOpacity(view)"
      />
    </template>
  </g>
</template>
