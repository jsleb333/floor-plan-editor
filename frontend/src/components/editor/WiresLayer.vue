<script setup lang="ts">
import { computed } from 'vue'

import type { WireToolPreview } from '@/composables/useWireTool'
import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type { Point } from '@/types/plan'
import { wireEndpoint, wirePathData } from '@/utils/geometry'

const props = defineProps<{
  /** World-unit stroke width rendering as ~1px on screen (kept for parity with siblings). */
  hairline: number
  /** The rubber-band wire the wire tool would draw next, if any. */
  preview?: WireToolPreview | null
  /** World centre of the device hovered as a wire target (highlighted), if any. */
  hoverCenter?: Point | null
  /** World centre of the current chain source device, if any. */
  sourceCenter?: Point | null
}>()

/** Screen-constant wire stroke widths (px), via non-scaling-stroke. */
const WIRE_WIDTH_PX = 1.5
const WIRE_SELECTED_WIDTH_PX = 3
const DANGLING_WIDTH_PX = 1.5
/** Opacity of wires dimmed under circuit isolation (spec C5). */
const DIM_OPACITY = 0.25
const HANDLE_RADIUS_PX = 7

const editorStore = useEditorStore()
const layersStore = useLayersStore()

interface WireView {
  id: string
  path: string
  color: string
  selected: boolean
  dangling: boolean
  dimmed: boolean
  width: number
}

const wireViews = computed<WireView[]>(() => {
  void editorStore.documentVersion
  void editorStore.selection
  const document = editorStore.document
  if (!document) return []
  const devicesById = new Map(document.devices.map((device) => [device.id, device]))
  const circuitsById = new Map(document.circuits.map((circuit) => [circuit.id, circuit]))
  const isolated = editorStore.isolatedCircuitId
  const views: WireView[] = []
  for (const wire of document.wires) {
    const circuit = circuitsById.get(wire.circuit_id)
    if (circuit && !layersStore.isCircuitWiresVisible(circuit.id)) continue
    const from = wireEndpoint(devicesById.get(wire.from_device_id), document.walls)
    const to = wireEndpoint(devicesById.get(wire.to_device_id), document.walls)
    const selected = editorStore.isSelected({ kind: 'wire', id: wire.id })
    const dangling = !circuit || !from || !to
    if (dangling) {
      // Route a dangling wire between whatever endpoints resolve, or skip it.
      if (!from || !to) continue
      views.push({
        id: wire.id,
        path: wirePathData(from, wire.control_points, to),
        color: '#dc2626',
        selected,
        dangling: true,
        dimmed: false,
        width: DANGLING_WIDTH_PX,
      })
      continue
    }
    const dimmed = isolated !== null && wire.circuit_id !== isolated
    views.push({
      id: wire.id,
      path: wirePathData(from, wire.control_points, to),
      color: circuit.color,
      selected,
      dangling: false,
      dimmed,
      width: selected ? WIRE_SELECTED_WIDTH_PX : WIRE_WIDTH_PX,
    })
  }
  return views
})

const previewPath = computed<string | null>(() =>
  props.preview
    ? wirePathData(props.preview.from, props.preview.controlPoints, props.preview.to)
    : null,
)
</script>

<template>
  <g aria-label="Wires" style="pointer-events: none">
    <path
      v-for="view in wireViews"
      :key="view.id"
      :d="view.path"
      fill="none"
      :stroke="view.color"
      :stroke-width="view.width"
      vector-effect="non-scaling-stroke"
      stroke-linecap="round"
      :stroke-dasharray="view.dangling ? '5 4' : undefined"
      :opacity="view.dimmed ? DIM_OPACITY : view.dangling ? 1 : 0.85"
    />

    <circle
      v-if="sourceCenter"
      :cx="sourceCenter.x"
      :cy="sourceCenter.y"
      :r="HANDLE_RADIUS_PX * hairline"
      fill="none"
      class="stroke-accent-strong"
      stroke-width="1.5"
      vector-effect="non-scaling-stroke"
    />
    <circle
      v-if="hoverCenter"
      :cx="hoverCenter.x"
      :cy="hoverCenter.y"
      :r="HANDLE_RADIUS_PX * hairline"
      fill="none"
      class="stroke-accent"
      stroke-width="1.5"
      stroke-dasharray="3 3"
      vector-effect="non-scaling-stroke"
    />
    <path
      v-if="previewPath && preview"
      :d="previewPath"
      fill="none"
      :stroke="preview.color"
      stroke-width="1.5"
      vector-effect="non-scaling-stroke"
      stroke-linecap="round"
      stroke-dasharray="6 4"
      opacity="0.7"
    />
  </g>
</template>
