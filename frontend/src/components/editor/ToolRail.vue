<script setup lang="ts">
import type { ToolDefinition, ToolId } from '@/components/editor/tools'

defineProps<{
  tools: readonly ToolDefinition[]
  activeTool: ToolId
}>()

const emit = defineEmits<{
  select: [id: ToolId]
}>()

function toolClasses(tool: ToolDefinition, activeTool: ToolId): string {
  if (tool.id === activeTool) return 'bg-accent-soft text-accent'
  if (!tool.enabled) return 'text-ink-faint opacity-45 cursor-not-allowed'
  return 'text-ink-muted hover:bg-canvas hover:text-ink'
}
</script>

<template>
  <nav
    aria-label="Tools"
    class="border-line bg-surface flex w-12 shrink-0 flex-col items-center gap-1 border-r py-2"
  >
    <button
      v-for="tool in tools"
      :key="tool.id"
      type="button"
      :disabled="!tool.enabled"
      :title="`${tool.name} (${tool.shortcut.toUpperCase()})`"
      :aria-label="`${tool.name} (${tool.shortcut.toUpperCase()})`"
      :aria-pressed="tool.id === activeTool"
      class="rounded-md p-2 transition-colors"
      :class="toolClasses(tool, activeTool)"
      @click="emit('select', tool.id)"
    >
      <component :is="tool.icon" :size="18" aria-hidden="true" />
    </button>
  </nav>
</template>
