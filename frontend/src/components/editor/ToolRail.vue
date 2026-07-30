<script setup lang="ts">
import { computed } from 'vue'

import type { ToolDefinition, ToolId } from '@/components/editor/tools'

const props = defineProps<{
  tools: readonly ToolDefinition[]
  activeTool: ToolId
}>()

const emit = defineEmits<{
  select: [id: ToolId]
}>()

/**
 * Index of the active segment; -1 hides the highlight (the armed tool may
 * briefly be absent from the rail while a mode switch settles).
 */
const activeIndex = computed(() => props.tools.findIndex((tool) => tool.id === props.activeTool))

/** One segment tall and gapless, so each step slides by exactly its own height. */
const highlightStyle = computed(() => ({
  transform: `translateY(${activeIndex.value * 100}%)`,
}))

function toolClasses(tool: ToolDefinition, activeTool: ToolId): string {
  if (tool.id === activeTool) return 'text-accent'
  if (!tool.enabled) return 'text-ink-faint opacity-45 cursor-not-allowed'
  return 'text-ink-muted hover:text-ink'
}
</script>

<template>
  <nav
    aria-label="Tools"
    class="border-line bg-surface shadow-panel m-3 max-h-[calc(100%-3rem)] overflow-y-auto rounded-full border p-1"
  >
    <!-- Own positioning context for the sliding highlight, like the mode pill. -->
    <div class="relative flex flex-col">
      <span
        v-show="activeIndex >= 0"
        class="bg-accent-soft absolute top-0 left-0 h-9 w-9 rounded-full transition-transform duration-300 ease-out motion-reduce:transition-none"
        :style="highlightStyle"
        aria-hidden="true"
      />
      <button
        v-for="tool in tools"
        :key="tool.id"
        type="button"
        :disabled="!tool.enabled"
        :title="`${tool.name} (${tool.shortcut.toUpperCase()})`"
        :aria-label="`${tool.name} (${tool.shortcut.toUpperCase()})`"
        :aria-pressed="tool.id === activeTool"
        class="relative flex h-9 w-9 items-center justify-center rounded-full transition-colors"
        :class="toolClasses(tool, activeTool)"
        @click="emit('select', tool.id)"
      >
        <component :is="tool.icon" :size="18" aria-hidden="true" />
      </button>
    </div>
  </nav>
</template>
