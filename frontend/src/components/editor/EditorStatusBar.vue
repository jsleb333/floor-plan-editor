<script setup lang="ts">
import { Grid3x3, Magnet, Ruler } from 'lucide-vue-next'
import { computed } from 'vue'

import type { SnapToggleId } from '@/composables/useSnapping'
import type { Point } from '@/types/plan'
import type { WallReference } from '@/utils/geometry'
import { formatFeetInches } from '@/utils/units'

const props = defineProps<{
  cursor: Point | null
  zoomPercent: number
  snapGrid: boolean
  snapAngle: boolean
  snapWalls: boolean
  /** Reference side shown while the wall tool is active; null hides the indicator. */
  wallReference: WallReference | null
  /** Exact-input buffer echo (spec S2); hidden when empty. */
  inputBuffer: string
  /** Active circuit name shown while the wire tool is active; null hides it (spec §6.1). */
  activeCircuitName: string | null
  /** Active circuit colour swatch, paired with the name. */
  activeCircuitColor: string | null
}>()

const emit = defineEmits<{
  'toggle-snap': [id: SnapToggleId]
  'show-shortcuts': []
}>()

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

    <span v-if="wallReference" aria-label="Wall reference side">
      ref: <span class="text-ink">{{ REFERENCE_LABELS[wallReference] }}</span>
    </span>

    <span v-if="inputBuffer" class="text-ink tabular-nums" aria-label="Typed length">
      {{ inputBuffer }} ⏎
    </span>

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
        {{ formatFeetInches(cursor.x) }}, {{ formatFeetInches(cursor.y) }}
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
