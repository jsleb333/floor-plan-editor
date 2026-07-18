<script setup lang="ts">
import { computed } from 'vue'

import type { DeviceToolChip } from '@/composables/useDeviceTool'
import { add, normalize, perpendicular, scale, sub } from '@/utils/geometry'

const CHIP_FONT_PX = 11
const CHIP_OFFSET_PX = 8
const TICK_HALF_PX = 4

const props = defineProps<{
  /** Live temporary-dimension chips during placement (spec S2a). */
  chips: readonly DeviceToolChip[]
  /** World-unit stroke width rendering as ~1px on screen. */
  hairline: number
}>()

interface ChipView {
  side: 'left' | 'right'
  active: boolean
  label: string
  from: { x: number; y: number }
  to: { x: number; y: number }
  labelAt: { x: number; y: number }
}

const chipViews = computed<ChipView[]>(() =>
  props.chips.map((chip) => {
    const mid = { x: (chip.from.x + chip.to.x) / 2, y: (chip.from.y + chip.to.y) / 2 }
    const away = perpendicular(normalize(sub(chip.to, chip.from)))
    return {
      side: chip.side,
      active: chip.active,
      label: chip.label,
      from: chip.from,
      to: chip.to,
      labelAt: add(mid, scale(away, CHIP_OFFSET_PX * props.hairline)),
    }
  }),
)

function tickPoints(chip: ChipView, end: 'from' | 'to'): string {
  const across = perpendicular(normalize(sub(chip.to, chip.from)))
  const at = chip[end]
  const a = add(at, scale(across, TICK_HALF_PX * props.hairline))
  const b = add(at, scale(across, -TICK_HALF_PX * props.hairline))
  return `${a.x},${a.y} ${b.x},${b.y}`
}
</script>

<template>
  <g aria-label="Device placement dimensions">
    <g v-for="chip in chipViews" :key="chip.side" aria-label="Temporary dimension">
      <line
        :x1="chip.from.x"
        :y1="chip.from.y"
        :x2="chip.to.x"
        :y2="chip.to.y"
        :class="chip.active ? 'stroke-accent-strong' : 'stroke-accent/60'"
        :stroke-width="(chip.active ? 1.5 : 1) * hairline"
      />
      <polyline
        :points="tickPoints(chip, 'from')"
        fill="none"
        :class="chip.active ? 'stroke-accent-strong' : 'stroke-accent/60'"
        :stroke-width="hairline"
      />
      <polyline
        :points="tickPoints(chip, 'to')"
        fill="none"
        :class="chip.active ? 'stroke-accent-strong' : 'stroke-accent/60'"
        :stroke-width="hairline"
      />
      <text
        :x="chip.labelAt.x"
        :y="chip.labelAt.y"
        :font-size="CHIP_FONT_PX * hairline"
        text-anchor="middle"
        paint-order="stroke"
        :stroke-width="3 * hairline"
        class="stroke-surface select-none"
        :class="chip.active ? 'fill-accent-strong font-semibold' : 'fill-ink-muted'"
      >
        {{ chip.label }}
      </text>
    </g>
  </g>
</template>
