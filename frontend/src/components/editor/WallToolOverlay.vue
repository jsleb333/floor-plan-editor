<script setup lang="ts">
import { computed } from 'vue'

import type { WallToolPreview } from '@/composables/useWallTool'
import { add, lerp, normalize, perpendicular, scale, sub } from '@/utils/geometry'
import { ringsToPath } from '@/utils/svgPath'

const GUIDE_LENGTH_IN = 10000
const LABEL_OFFSET_PX = 12
const LABEL_FONT_PX = 11
const MARKER_HALF_PX = 4.5
const CLOSE_RADIUS_PX = 8

const props = defineProps<{
  preview: WallToolPreview
  /** World-unit stroke width rendering as ~1px on screen. */
  hairline: number
}>()

const silhouettePath = computed(() => ringsToPath(props.preview.rings))

const chainPath = computed(() => {
  const points = props.preview.point
    ? [...props.preview.vertices, props.preview.point]
    : props.preview.vertices
  if (points.length < 2) return ''
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
})

const guideEnd = computed(() => {
  const guide = props.preview.guide
  return guide ? add(guide.origin, scale(guide.dir, GUIDE_LENGTH_IN)) : null
})

const alignGuideEnd = computed(() => {
  const guide = props.preview.alignGuide
  return guide ? add(guide.origin, scale(guide.dir, GUIDE_LENGTH_IN)) : null
})

const labelPosition = computed(() => {
  const segment = props.preview.segment
  if (!segment) return null
  const mid = lerp(segment.a, segment.b, 0.5)
  const away = perpendicular(normalize(sub(segment.b, segment.a)))
  return add(mid, scale(away, LABEL_OFFSET_PX * props.hairline))
})
</script>

<template>
  <g aria-label="Wall drawing preview">
    <path
      v-if="silhouettePath"
      :d="silhouettePath"
      fill-rule="evenodd"
      class="fill-accent/25 stroke-accent"
      :stroke-width="hairline"
    />

    <line
      v-if="preview.guide && guideEnd"
      :x1="preview.guide.origin.x"
      :y1="preview.guide.origin.y"
      :x2="guideEnd.x"
      :y2="guideEnd.y"
      class="stroke-accent/40"
      :stroke-width="hairline"
      :stroke-dasharray="`${6 * hairline} ${6 * hairline}`"
    />

    <line
      v-if="preview.alignGuide && alignGuideEnd"
      :x1="preview.alignGuide.origin.x"
      :y1="preview.alignGuide.origin.y"
      :x2="alignGuideEnd.x"
      :y2="alignGuideEnd.y"
      class="stroke-accent/40"
      :stroke-width="hairline"
      :stroke-dasharray="`${2 * hairline} ${4 * hairline}`"
    />

    <path
      v-if="chainPath"
      :d="chainPath"
      fill="none"
      class="stroke-accent-strong"
      :stroke-width="hairline"
    />

    <line
      v-if="preview.segment"
      :x1="preview.segment.a.x"
      :y1="preview.segment.a.y"
      :x2="preview.segment.b.x"
      :y2="preview.segment.b.y"
      class="stroke-accent-strong"
      :stroke-width="1.5 * hairline"
      :stroke-dasharray="`${4 * hairline} ${4 * hairline}`"
    />

    <circle
      v-for="(vertex, index) in preview.vertices"
      :key="index"
      :cx="vertex.x"
      :cy="vertex.y"
      :r="2.5 * hairline"
      class="fill-accent-strong"
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

    <g v-if="preview.closePoint">
      <circle
        :cx="preview.closePoint.x"
        :cy="preview.closePoint.y"
        :r="CLOSE_RADIUS_PX * hairline"
        class="fill-accent-soft/70 stroke-accent-strong"
        :stroke-width="2 * hairline"
      />
      <circle
        :cx="preview.closePoint.x"
        :cy="preview.closePoint.y"
        :r="2 * hairline"
        class="fill-accent-strong"
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
      v-if="labelPosition && preview.lengthLabel"
      :x="labelPosition.x"
      :y="labelPosition.y"
      :font-size="LABEL_FONT_PX * hairline"
      text-anchor="middle"
      paint-order="stroke"
      :stroke-width="3 * hairline"
      class="fill-ink stroke-surface select-none"
    >
      {{ preview.lengthLabel }}
    </text>
  </g>
</template>
