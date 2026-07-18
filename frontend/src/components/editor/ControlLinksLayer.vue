<script setup lang="ts">
import { computed } from 'vue'

import { useEditorStore } from '@/stores/editor'
import type { Point } from '@/types/plan'
import {
  add,
  distance,
  lerp,
  normalize,
  perpendicular,
  scale,
  sub,
  wireEndpoint,
} from '@/utils/geometry'

const props = defineProps<{
  /** World-unit stroke width rendering as ~1px on screen. */
  hairline: number
  /** World centre of the switch a control link is being armed from, if any (spec D6). */
  armedCenter?: Point | null
  /** Cursor position, to preview the armed link to the pointer. */
  cursor?: Point | null
}>()

/** Perpendicular bulge of the documentary arc, as a fraction of endpoint distance. */
const ARC_BULGE_FACTOR = 0.2

const editorStore = useEditorStore()

/** Quadratic-arc path with a gentle perpendicular bulge, drawn on hover/selection (spec D6). */
function arcPath(from: Point, to: Point): string {
  const span = sub(to, from)
  const len = distance(from, to)
  const control =
    len <= 0
      ? { ...from }
      : add(lerp(from, to, 0.5), scale(perpendicular(normalize(span)), len * ARC_BULGE_FACTOR))
  return `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`
}

interface ArcView {
  id: string
  path: string
}

const arcViews = computed<ArcView[]>(() => {
  void editorStore.documentVersion
  void editorStore.selection
  const document = editorStore.document
  if (!document) return []
  const devicesById = new Map(document.devices.map((device) => [device.id, device]))
  const views: ArcView[] = []
  for (const link of document.control_links) {
    const switchSelected = editorStore.isSelected({ kind: 'device', id: link.switch_id })
    const targetSelected = editorStore.isSelected({ kind: 'device', id: link.target_id })
    if (!switchSelected && !targetSelected) continue
    const from = wireEndpoint(devicesById.get(link.switch_id), document.walls)
    const to = wireEndpoint(devicesById.get(link.target_id), document.walls)
    if (!from || !to) continue
    views.push({ id: link.id, path: arcPath(from, to) })
  }
  return views
})

const previewPath = computed<string | null>(() =>
  props.armedCenter && props.cursor ? arcPath(props.armedCenter, props.cursor) : null,
)
</script>

<template>
  <g aria-label="Control links" style="pointer-events: none">
    <path
      v-for="view in arcViews"
      :key="view.id"
      :d="view.path"
      fill="none"
      class="stroke-accent"
      stroke-width="1.5"
      vector-effect="non-scaling-stroke"
      stroke-dasharray="4 4"
      opacity="0.4"
    />
    <path
      v-if="previewPath"
      :d="previewPath"
      fill="none"
      class="stroke-accent"
      stroke-width="1.5"
      vector-effect="non-scaling-stroke"
      stroke-dasharray="4 4"
      opacity="0.6"
    />
  </g>
</template>
