<script setup lang="ts">
import { computed } from 'vue'

import { DEVICE_PICTOGRAMS } from '@/devices/pictograms'
import type { PictogramShape } from '@/devices/pictograms'
import type { DeviceType } from '@/types/plan'

const props = defineProps<{
  type: DeviceType
  /** Stroke width in screen pixels (strokes are non-scaling). */
  strokeWidth?: number
}>()

const shapes = computed<readonly PictogramShape[]>(() => DEVICE_PICTOGRAMS[props.type])
const stroke = computed(() => props.strokeWidth ?? 1.4)

function polylinePoints(points: readonly [number, number][]): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ')
}
</script>

<template>
  <g
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <template v-for="(shape, index) in shapes" :key="index">
      <circle
        v-if="shape.kind === 'circle'"
        :cx="shape.cx"
        :cy="shape.cy"
        :r="shape.r"
        :fill="shape.fill ? 'currentColor' : 'none'"
        vector-effect="non-scaling-stroke"
      />
      <line
        v-else-if="shape.kind === 'line'"
        :x1="shape.x1"
        :y1="shape.y1"
        :x2="shape.x2"
        :y2="shape.y2"
        vector-effect="non-scaling-stroke"
      />
      <polyline
        v-else-if="shape.kind === 'polyline'"
        :points="
          shape.closed
            ? `${polylinePoints(shape.points)} ${shape.points[0][0]},${shape.points[0][1]}`
            : polylinePoints(shape.points)
        "
        vector-effect="non-scaling-stroke"
      />
      <path v-else-if="shape.kind === 'path'" :d="shape.d" vector-effect="non-scaling-stroke" />
      <rect
        v-else-if="shape.kind === 'rect'"
        :x="shape.x"
        :y="shape.y"
        :width="shape.w"
        :height="shape.h"
        :fill="shape.fill ? 'currentColor' : 'none'"
        vector-effect="non-scaling-stroke"
      />
      <text
        v-else
        :x="shape.x"
        :y="shape.y"
        :font-size="shape.size"
        fill="currentColor"
        stroke="none"
        text-anchor="middle"
        dominant-baseline="central"
        font-family="sans-serif"
        class="select-none"
      >
        {{ shape.text }}
      </text>
    </template>
  </g>
</template>
