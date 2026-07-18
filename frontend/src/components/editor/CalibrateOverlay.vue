<script setup lang="ts">
import { computed } from 'vue'

import type { CalibrateToolPreview } from '@/composables/useCalibrateTool'
import { lerp } from '@/utils/geometry'

const props = defineProps<{
  preview: CalibrateToolPreview
  /** World-unit stroke width rendering as ~1px on screen. */
  hairline: number
}>()

const midpoint = computed(() =>
  props.preview.a && props.preview.b ? lerp(props.preview.a, props.preview.b, 0.5) : null,
)

const endpoints = computed(() =>
  [props.preview.a, props.preview.b].filter((point) => point !== null),
)
</script>

<template>
  <g aria-label="Calibration segment">
    <line
      v-if="preview.a && preview.b"
      :x1="preview.a.x"
      :y1="preview.a.y"
      :x2="preview.b.x"
      :y2="preview.b.y"
      class="stroke-accent-strong"
      fill="none"
      :stroke-width="1.5 * hairline"
      :stroke-dasharray="`${6 * hairline} ${4 * hairline}`"
    />
    <circle
      v-for="(end, index) in endpoints"
      :key="index"
      :cx="end.x"
      :cy="end.y"
      :r="4 * hairline"
      class="fill-surface stroke-accent-strong"
      :stroke-width="1.5 * hairline"
    />
    <text
      v-if="midpoint && preview.lengthLabel"
      :x="midpoint.x"
      :y="midpoint.y - 8 * hairline"
      text-anchor="middle"
      class="fill-accent-strong select-none tabular-nums"
      :font-size="12 * hairline"
    >
      {{ preview.awaitingLength ? `${preview.lengthLabel} = ?` : preview.lengthLabel }}
    </text>
  </g>
</template>
