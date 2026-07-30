<script setup lang="ts">
import { Grid3x3, Magnet, Mouse, Ruler, TriangleAlert } from 'lucide-vue-next'
import { computed } from 'vue'

import { useDisplayPrecision } from '@/composables/useDisplayPrecision'
import type { SnapToggleId } from '@/composables/useSnapping'
import type { ScrollMode } from '@/composables/useViewportGestures'
import type { Point } from '@/types/plan'
import type { WallReference } from '@/utils/geometry'
import { formatFeetInches } from '@/utils/units'

const props = defineProps<{
  cursor: Point | null
  zoomPercent: number
  snapGrid: boolean
  snapAngle: boolean
  snapWalls: boolean
  /** How an unmodified scroll gesture is interpreted (spec E5). */
  scrollMode: ScrollMode
  /** Reference side shown while the wall tool is active; null hides the indicator. */
  wallReference: WallReference | null
  /** Exact-input buffer echo (spec S2); hidden when empty. */
  inputBuffer: string
  /** Transient quiet notice (spec §6.2, e.g. the S1d preset switch); null hides it. */
  notice: string | null
  /** Active circuit name shown while the wire tool is active; null hides it (spec §6.1). */
  activeCircuitName: string | null
  /** Active circuit colour swatch, paired with the name. */
  activeCircuitColor: string | null
  /** Circuits at or past 80 % of their breaker (spec C4/§6.1); 0 hides the indicator. */
  warningCount?: number
}>()

const emit = defineEmits<{
  'toggle-snap': [id: SnapToggleId]
  'cycle-scroll-mode': []
  'show-shortcuts': []
  'open-circuits': []
}>()

const precisionIn = useDisplayPrecision()

const REFERENCE_LABELS: Record<WallReference, string> = {
  center: 'center',
  left: 'left face',
  right: 'right face',
}

const snapToggles = computed(() => [
  { id: 'grid' as const, label: 'grid', icon: Grid3x3, active: props.snapGrid },
  { id: 'angle' as const, label: '90°', icon: Magnet, active: props.snapAngle },
  { id: 'walls' as const, label: 'walls', icon: Ruler, active: props.snapWalls },
])

const SCROLL_MODE_HINTS: Record<ScrollMode, string> = {
  auto: 'wheel zooms, trackpad scroll pans',
  zoom: 'every scroll zooms to the cursor',
  pan: 'every scroll pans; Ctrl+scroll zooms',
}

const scrollModeTitle = computed(
  () =>
    `Scroll gesture: ${props.scrollMode} — ${SCROLL_MODE_HINTS[props.scrollMode]}. Click to change.`,
)

/** How many circuits the warning indicator stands for; 0 renders nothing. */
const warningCount = computed(() => props.warningCount ?? 0)

const warningLabel = computed(
  () => `${warningCount.value} ${warningCount.value === 1 ? 'circuit' : 'circuits'} over 80%`,
)
</script>

<template>
  <footer
    aria-label="Status bar"
    class="border-line bg-surface text-ink-muted flex h-8 shrink-0 items-center gap-4 border-t px-3 text-xs"
  >
    <div class="flex items-center gap-1" aria-label="Snap toggles">
      <span class="text-ink-faint mr-1">snap:</span>
      <button
        v-for="snap in snapToggles"
        :key="snap.id"
        type="button"
        :aria-pressed="snap.active"
        :aria-label="`Snap to ${snap.label}`"
        class="flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors"
        :class="snap.active ? 'bg-accent-soft text-accent' : 'text-ink-faint hover:text-ink'"
        @click="emit('toggle-snap', snap.id)"
      >
        <component :is="snap.icon" :size="12" aria-hidden="true" />
        {{ snap.label }}
      </button>
    </div>

    <button
      type="button"
      class="text-ink-faint hover:text-ink flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors"
      :title="scrollModeTitle"
      :aria-label="scrollModeTitle"
      @click="emit('cycle-scroll-mode')"
    >
      <Mouse :size="12" aria-hidden="true" />
      scroll: <span class="text-ink">{{ scrollMode }}</span>
    </button>

    <span v-if="wallReference" aria-label="Wall reference side">
      ref: <span class="text-ink">{{ REFERENCE_LABELS[wallReference] }}</span>
    </span>

    <span v-if="inputBuffer" class="text-ink tabular-nums" aria-label="Typed length">
      {{ inputBuffer }} ⏎
    </span>

    <span v-if="notice" role="status" class="text-accent">{{ notice }}</span>

    <button
      v-if="warningCount > 0"
      type="button"
      class="hover:bg-canvas flex items-center gap-1 rounded px-1.5 py-0.5 text-amber-600 transition-colors"
      :title="`${warningLabel} — show the circuits`"
      :aria-label="warningLabel"
      @click="emit('open-circuits')"
    >
      <TriangleAlert :size="12" aria-hidden="true" />
      <span class="tabular-nums">{{ warningCount }}</span>
    </button>

    <span v-if="activeCircuitName" class="flex items-center gap-1.5" aria-label="Active circuit">
      circuit:
      <span
        class="h-3 w-3 rounded"
        :style="{ backgroundColor: activeCircuitColor ?? '#64748b' }"
        aria-hidden="true"
      />
      <span class="text-ink">{{ activeCircuitName }}</span>
    </span>

    <span class="min-w-40 tabular-nums" aria-label="Cursor position">
      <template v-if="cursor">
        {{ formatFeetInches(cursor.x, precisionIn) }}, {{ formatFeetInches(cursor.y, precisionIn) }}
      </template>
      <template v-else>—</template>
    </span>

    <span class="ml-auto tabular-nums" aria-label="Zoom level">{{ zoomPercent }}%</span>

    <button
      type="button"
      class="text-ink-faint hover:bg-canvas hover:text-ink flex h-5 w-5 items-center justify-center rounded font-medium transition-colors"
      title="Keyboard shortcuts (?)"
      aria-label="Show keyboard shortcuts"
      @click="emit('show-shortcuts')"
    >
      ?
    </button>
  </footer>
</template>
