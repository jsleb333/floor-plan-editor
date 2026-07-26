<script setup lang="ts">
import { computed } from 'vue'

import type { LockFlash, SelectToolPreview } from '@/composables/useSelectTool'
import { useEditorStore } from '@/stores/editor'
import { add, lerp, normalize, perpendicular, scale, sub } from '@/utils/geometry'

const HANDLE_HALF_PX = 3.5
const CHIP_FONT_PX = 11
const CHIP_OFFSET_PX = 8
const TICK_HALF_PX = 4

const props = defineProps<{
  preview: SelectToolPreview
  /** Locked-segment refusal flashes to highlight (select tool + inspector). */
  flashes: readonly LockFlash[]
  /** World-unit stroke width rendering as ~1px on screen. */
  hairline: number
}>()

const editorStore = useEditorStore()

interface FlashLine {
  key: string
  x1: number
  y1: number
  x2: number
  y2: number
}

const flashLines = computed<FlashLine[]>(() => {
  void editorStore.documentVersion
  const walls = editorStore.document?.walls ?? []
  const lines: FlashLine[] = []
  for (const flash of props.flashes) {
    const wall = walls.find((candidate) => candidate.id === flash.wallId)
    if (!wall) continue
    const n = wall.vertices.length
    for (const segment of flash.segments) {
      const a = wall.vertices[segment]
      const b = wall.vertices[(segment + 1) % n]
      if (!a || !b) continue
      lines.push({ key: `${flash.wallId}:${segment}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y })
    }
  }
  return lines
})

/**
 * Chip colouring (specs S1a/S2a): face-anchored chips reuse the wall face
 * tints so "which face am I measuring to" reads at a glance; along-wall chips
 * (no face identity) keep the accent.
 */
const CHIP_CLASSES: Record<
  'left' | 'right' | 'none',
  { activeStroke: string; idleStroke: string; activeText: string }
> = {
  left: {
    activeStroke: 'stroke-face-left',
    idleStroke: 'stroke-face-left/60',
    activeText: 'fill-face-left font-semibold',
  },
  right: {
    activeStroke: 'stroke-face-right',
    idleStroke: 'stroke-face-right/60',
    activeText: 'fill-face-right font-semibold',
  },
  none: {
    activeStroke: 'stroke-accent-strong',
    idleStroke: 'stroke-accent/60',
    activeText: 'fill-accent-strong font-semibold',
  },
}

interface ChipView {
  side: 'left' | 'right'
  active: boolean
  label: string
  from: { x: number; y: number }
  to: { x: number; y: number }
  labelAt: { x: number; y: number }
  strokeClass: string
  textClass: string
}

const chipViews = computed<ChipView[]>(() =>
  props.preview.chips.map((chip) => {
    const mid = lerp(chip.from, chip.to, 0.5)
    const away = perpendicular(normalize(sub(chip.to, chip.from)))
    const classes = CHIP_CLASSES[chip.faceSide ?? 'none']
    return {
      side: chip.side,
      active: chip.active,
      label: chip.label,
      from: chip.from,
      to: chip.to,
      labelAt: add(mid, scale(away, CHIP_OFFSET_PX * props.hairline)),
      strokeClass: chip.active ? classes.activeStroke : classes.idleStroke,
      textClass: chip.active ? classes.activeText : 'fill-ink-muted',
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
  <g aria-label="Selection overlay">
    <rect
      v-if="preview.band"
      :x="preview.band.minX"
      :y="preview.band.minY"
      :width="preview.band.maxX - preview.band.minX"
      :height="preview.band.maxY - preview.band.minY"
      class="fill-accent/10 stroke-accent"
      :stroke-width="hairline"
      :stroke-dasharray="`${4 * hairline} ${4 * hairline}`"
    />

    <line
      v-for="flash in flashLines"
      :key="flash.key"
      :x1="flash.x1"
      :y1="flash.y1"
      :x2="flash.x2"
      :y2="flash.y2"
      class="stroke-danger animate-pulse"
      :stroke-width="4 * hairline"
      stroke-linecap="round"
    />

    <g v-for="chip in chipViews" :key="chip.side" aria-label="Temporary dimension">
      <line
        :x1="chip.from.x"
        :y1="chip.from.y"
        :x2="chip.to.x"
        :y2="chip.to.y"
        :class="chip.strokeClass"
        :stroke-width="(chip.active ? 1.5 : 1) * hairline"
      />
      <polyline
        :points="tickPoints(chip, 'from')"
        fill="none"
        :class="chip.strokeClass"
        :stroke-width="hairline"
      />
      <polyline
        :points="tickPoints(chip, 'to')"
        fill="none"
        :class="chip.strokeClass"
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
        :class="chip.textClass"
      >
        {{ chip.label }}
      </text>
    </g>

    <rect
      v-for="handle in preview.handles"
      :key="`${handle.wallId}:${handle.vertexIndex}`"
      :x="handle.point.x - HANDLE_HALF_PX * hairline"
      :y="handle.point.y - HANDLE_HALF_PX * hairline"
      :width="2 * HANDLE_HALF_PX * hairline"
      :height="2 * HANDLE_HALF_PX * hairline"
      class="fill-surface stroke-accent-strong"
      :stroke-width="1.5 * hairline"
    />

    <circle
      v-for="endpoint in preview.wireEndpoints"
      :key="`we-${endpoint.x}-${endpoint.y}`"
      :cx="endpoint.x"
      :cy="endpoint.y"
      :r="HANDLE_HALF_PX * hairline"
      class="fill-accent-strong"
    />
    <circle
      v-for="handle in preview.wireHandles"
      :key="`${handle.wireId}:${handle.handleIndex}`"
      :cx="handle.point.x"
      :cy="handle.point.y"
      :r="(HANDLE_HALF_PX + 1) * hairline"
      class="fill-surface stroke-accent-strong"
      :stroke-width="1.5 * hairline"
    />

    <g v-if="preview.underlayRotationHandle" aria-label="Underlay rotation handle">
      <line
        :x1="preview.underlayRotationHandle.anchor.x"
        :y1="preview.underlayRotationHandle.anchor.y"
        :x2="preview.underlayRotationHandle.point.x"
        :y2="preview.underlayRotationHandle.point.y"
        class="stroke-accent-strong"
        :stroke-width="hairline"
      />
      <circle
        :cx="preview.underlayRotationHandle.point.x"
        :cy="preview.underlayRotationHandle.point.y"
        :r="(HANDLE_HALF_PX + 1) * hairline"
        class="fill-surface stroke-accent-strong cursor-grab"
        :stroke-width="1.5 * hairline"
      />
    </g>
  </g>
</template>
