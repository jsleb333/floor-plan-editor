<script setup lang="ts">
import { computed } from 'vue'

import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type { Point } from '@/types/plan'
import { add, scale } from '@/utils/geometry'

/**
 * Half-length of the segment an infinite guide is drawn as, in inches: ~1.6
 * miles either way, past any plan at any zoom, and a plain two-point line at
 * every zoom rather than a per-frame viewport clip.
 */
const GUIDE_HALF_LENGTH_IN = 100000

const props = defineProps<{
  /** World-unit stroke width rendering as ~1px on screen. */
  hairline: number
}>()

const editorStore = useEditorStore()
const layersStore = useLayersStore()

interface GuideView {
  id: string
  a: Point
  b: Point
  selected: boolean
}

const guideViews = computed<GuideView[]>(() =>
  editorStore.guideLines.map((line) => ({
    id: line.guideId,
    a: add(line.point, scale(line.dir, -GUIDE_HALF_LENGTH_IN)),
    b: add(line.point, scale(line.dir, GUIDE_HALF_LENGTH_IN)),
    selected: editorStore.isSelected({ kind: 'guide', id: line.guideId }),
  })),
)

/**
 * A long-short-short rhythm, deliberately unlike the transient S1e alignment
 * guides' even dots (spec S9: guides must read as placed, not as feedback).
 */
const dashArray = computed(() => {
  const h = props.hairline
  return `${12 * h} ${4 * h} ${3 * h} ${4 * h}`
})
</script>

<template>
  <g v-if="layersStore.guidesVisible" aria-label="Custom guides">
    <line
      v-for="view in guideViews"
      :key="view.id"
      :x1="view.a.x"
      :y1="view.a.y"
      :x2="view.b.x"
      :y2="view.b.y"
      :class="view.selected ? 'stroke-accent-strong' : 'stroke-ink-faint'"
      :stroke-width="(view.selected ? 1.5 : 1) * hairline"
      :stroke-dasharray="dashArray"
    />
  </g>
</template>
