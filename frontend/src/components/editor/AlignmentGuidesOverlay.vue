<script setup lang="ts">
import { computed } from 'vue'

import type { Point } from '@/types/plan'
import type { AlignmentGuide } from '@/utils/geometry'

const MARKER_HALF_PX = 3.5

const props = defineProps<{
  /** Guides currently engaged (at most two, spec S1e); emptying the list fades them out. */
  guides: readonly AlignmentGuide[]
  /** Snapped pending point the guides lead to; ignored while `guides` is empty. */
  point: Point | null
  /** World-unit stroke width rendering as ~1px on screen. */
  hairline: number
}>()

interface GuideView {
  key: string
  anchor: Point
  point: Point
}

const guideViews = computed<GuideView[]>(() => {
  const point = props.point
  if (!point) return []
  return props.guides.map((guide) => ({
    key: [
      guide.kind,
      guide.anchor.x.toFixed(4),
      guide.anchor.y.toFixed(4),
      guide.dir.x.toFixed(4),
      guide.dir.y.toFixed(4),
    ].join(':'),
    anchor: guide.anchor,
    point,
  }))
})
</script>

<template>
  <g aria-label="Alignment guides">
    <TransitionGroup name="guide-fade">
      <g v-for="view in guideViews" :key="view.key">
        <line
          :x1="view.anchor.x"
          :y1="view.anchor.y"
          :x2="view.point.x"
          :y2="view.point.y"
          class="stroke-accent/40"
          :stroke-width="hairline"
          :stroke-dasharray="`${2 * hairline} ${4 * hairline}`"
        />
        <line
          :x1="view.anchor.x - MARKER_HALF_PX * hairline"
          :y1="view.anchor.y - MARKER_HALF_PX * hairline"
          :x2="view.anchor.x + MARKER_HALF_PX * hairline"
          :y2="view.anchor.y + MARKER_HALF_PX * hairline"
          class="stroke-accent-strong"
          :stroke-width="1.5 * hairline"
        />
        <line
          :x1="view.anchor.x - MARKER_HALF_PX * hairline"
          :y1="view.anchor.y + MARKER_HALF_PX * hairline"
          :x2="view.anchor.x + MARKER_HALF_PX * hairline"
          :y2="view.anchor.y - MARKER_HALF_PX * hairline"
          class="stroke-accent-strong"
          :stroke-width="1.5 * hairline"
        />
      </g>
    </TransitionGroup>
  </g>
</template>

<style scoped>
/* Spec S1e noise control: guides fade in and out instead of blinking. */
.guide-fade-enter-active,
.guide-fade-leave-active {
  transition: opacity 150ms ease;
}

.guide-fade-enter-from,
.guide-fade-leave-to {
  opacity: 0;
}
</style>
