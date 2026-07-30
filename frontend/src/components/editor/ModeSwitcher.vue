<script setup lang="ts">
import { computed } from 'vue'

import { MODES } from '@/components/editor/tools'
import type { ModeId } from '@/components/editor/tools'

const props = defineProps<{
  activeMode: ModeId
}>()

const emit = defineEmits<{
  select: [mode: ModeId]
}>()

/** Index of the active segment; drives the sliding highlight's translation. */
const activeIndex = computed(() => MODES.findIndex((mode) => mode.id === props.activeMode))

/**
 * The highlight is one segment wide, so each step slides it by exactly its
 * own width — which is why the segments carry no gap between them.
 */
const highlightStyle = computed(() => ({
  transform: `translateX(${activeIndex.value * 100}%)`,
}))
</script>

<template>
  <nav
    aria-label="Editor modes"
    class="border-line bg-surface shadow-panel rounded-full border p-1"
  >
    <!-- Own positioning context for the sliding highlight, so the nav root
         stays free for the parent's fallthrough placement classes. -->
    <div class="relative flex items-center">
      <span
        class="bg-accent-soft absolute top-0 left-0 h-9 w-9 rounded-full transition-transform duration-300 ease-out motion-reduce:transition-none"
        :style="highlightStyle"
        aria-hidden="true"
      />
      <button
        v-for="mode in MODES"
        :key="mode.id"
        type="button"
        :title="`${mode.name} (${mode.shortcut.toUpperCase()})`"
        :aria-label="mode.name"
        :aria-pressed="mode.id === activeMode"
        class="relative flex h-9 w-9 items-center justify-center rounded-full transition-colors"
        :class="mode.id === activeMode ? 'text-accent' : 'text-ink-muted hover:text-ink'"
        @click="emit('select', mode.id)"
      >
        <component :is="mode.icon" :size="16" aria-hidden="true" />
      </button>
    </div>
  </nav>
</template>
