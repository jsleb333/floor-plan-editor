<script setup lang="ts">
import { computed } from 'vue'

import type { TapeToolPreview } from '@/composables/useTapeTool'
import type { Point } from '@/types/plan'
import { add, scale } from '@/utils/geometry'

/** Half-length the pending infinite line is drawn as, matching `GuidesLayer`. */
const GUIDE_HALF_LENGTH_IN = 100000
const CHIP_OFFSET_PX = 12
const CHIP_FONT_PX = 11
const CHIP_LINE_PX = 12
const MARKER_HALF_PX = 4.5
const START_MARKER_RADIUS_PX = 3

const props = defineProps<{
  preview: TapeToolPreview
  /** World-unit stroke width rendering as ~1px on screen. */
  hairline: number
}>()

const pendingLine = computed<{ a: Point; b: Point } | null>(() => {
  const line = props.preview.line
  if (!line) return null
  return {
    a: add(line.point, scale(line.dir, -GUIDE_HALF_LENGTH_IN)),
    b: add(line.point, scale(line.dir, GUIDE_HALF_LENGTH_IN)),
  }
})

const chipPosition = computed<Point | null>(() => {
  const chip = props.preview.chip
  if (!chip) return null
  const offset = CHIP_OFFSET_PX * props.hairline
  return { x: chip.at.x + offset, y: chip.at.y - offset }
})
</script>

<template>
  <g aria-label="Tape measure preview">
    <line
      v-if="pendingLine"
      :x1="pendingLine.a.x"
      :y1="pendingLine.a.y"
      :x2="pendingLine.b.x"
      :y2="pendingLine.b.y"
      class="stroke-accent-strong"
      :stroke-width="hairline"
      :stroke-dasharray="`${12 * hairline} ${4 * hairline} ${3 * hairline} ${4 * hairline}`"
    />

    <circle
      v-if="preview.start"
      :cx="preview.start.x"
      :cy="preview.start.y"
      :r="START_MARKER_RADIUS_PX * hairline"
      class="fill-surface stroke-accent-strong"
      :stroke-width="1.5 * hairline"
    />

    <g v-if="preview.marker">
      <rect
        v-if="preview.marker.kind === 'endpoint'"
        :x="preview.marker.point.x - MARKER_HALF_PX * hairline"
        :y="preview.marker.point.y - MARKER_HALF_PX * hairline"
        :width="2 * MARKER_HALF_PX * hairline"
        :height="2 * MARKER_HALF_PX * hairline"
        class="fill-surface stroke-accent-strong"
        :stroke-width="1.5 * hairline"
      />
      <rect
        v-else-if="preview.marker.kind === 'midpoint'"
        :x="preview.marker.point.x - MARKER_HALF_PX * hairline"
        :y="preview.marker.point.y - MARKER_HALF_PX * hairline"
        :width="2 * MARKER_HALF_PX * hairline"
        :height="2 * MARKER_HALF_PX * hairline"
        :transform="`rotate(45 ${preview.marker.point.x} ${preview.marker.point.y})`"
        class="fill-surface stroke-accent-strong"
        :stroke-width="1.5 * hairline"
      />
      <circle
        v-else
        :cx="preview.marker.point.x"
        :cy="preview.marker.point.y"
        :r="MARKER_HALF_PX * hairline"
        class="fill-surface stroke-accent-strong"
        :stroke-width="1.5 * hairline"
      />
    </g>

    <circle
      v-else-if="preview.point"
      :cx="preview.point.x"
      :cy="preview.point.y"
      :r="2 * hairline"
      class="fill-accent-strong"
    />

    <text
      v-if="preview.chip && chipPosition"
      :x="chipPosition.x"
      :y="chipPosition.y"
      :font-size="CHIP_FONT_PX * hairline"
      paint-order="stroke"
      :stroke-width="3 * hairline"
      class="fill-ink stroke-surface select-none"
    >
      {{ preview.chip.text }}
      <tspan
        v-if="preview.chip.secondary"
        :x="chipPosition.x"
        :dy="CHIP_LINE_PX * hairline"
        class="fill-ink-muted"
      >
        {{ preview.chip.secondary }}
      </tspan>
    </text>
  </g>
</template>
