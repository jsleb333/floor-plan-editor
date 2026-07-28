<script setup lang="ts">
import { MODES } from '@/components/editor/tools'
import type { ModeDefinition, ModeId } from '@/components/editor/tools'

defineProps<{
  activeMode: ModeId
}>()

const emit = defineEmits<{
  select: [mode: ModeId]
}>()

function modeClasses(mode: ModeDefinition, activeMode: ModeId): string {
  if (mode.id === activeMode) return 'bg-accent-soft text-accent'
  return 'text-ink-muted hover:bg-canvas hover:text-ink'
}
</script>

<template>
  <nav
    aria-label="Editor modes"
    class="border-line bg-surface shadow-panel flex items-center gap-0.5 rounded-full border p-1"
  >
    <button
      v-for="mode in MODES"
      :key="mode.id"
      type="button"
      :title="`${mode.name} (${mode.shortcut.toUpperCase()})`"
      :aria-pressed="mode.id === activeMode"
      class="rounded-full px-3 py-1 text-xs font-medium transition-colors"
      :class="modeClasses(mode, activeMode)"
      @click="emit('select', mode.id)"
    >
      {{ mode.name }}
    </button>
  </nav>
</template>
