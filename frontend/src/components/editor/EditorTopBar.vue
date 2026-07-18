<script setup lang="ts">
import {
  ArrowLeft,
  Check,
  Download,
  LoaderCircle,
  Maximize,
  Pencil,
  TriangleAlert,
} from 'lucide-vue-next'
import { nextTick, ref } from 'vue'
import { RouterLink } from 'vue-router'

import type { SaveState } from '@/stores/editor'

const props = defineProps<{
  planName: string
  saveState: SaveState
  saveError: string | null
  zoomPercent: number
}>()

const emit = defineEmits<{
  rename: [name: string]
  'zoom-fit': []
  'zoom-reset': []
  export: []
}>()

const editing = ref(false)
const draftName = ref('')
const nameInput = ref<HTMLInputElement | null>(null)

async function startEditing(): Promise<void> {
  draftName.value = props.planName
  editing.value = true
  await nextTick()
  nameInput.value?.select()
}

function commitRename(): void {
  if (!editing.value) return
  editing.value = false
  const name = draftName.value.trim()
  if (name && name !== props.planName) {
    emit('rename', name)
  }
}

function cancelRename(): void {
  editing.value = false
}
</script>

<template>
  <header
    aria-label="Editor toolbar"
    class="border-line bg-surface flex h-12 shrink-0 items-center gap-3 border-b px-3"
  >
    <RouterLink
      :to="{ name: 'plans' }"
      class="text-ink-muted hover:text-ink flex items-center gap-1 text-sm transition-colors"
      aria-label="Back to plans"
    >
      <ArrowLeft :size="16" aria-hidden="true" />
      plans
    </RouterLink>

    <span class="text-line select-none" aria-hidden="true">|</span>

    <input
      v-if="editing"
      ref="nameInput"
      v-model="draftName"
      type="text"
      aria-label="Plan name"
      class="border-line focus:border-accent w-56 rounded border px-2 py-0.5 text-sm font-medium outline-none"
      @keydown.enter="commitRename"
      @keydown.esc="cancelRename"
      @blur="commitRename"
    />
    <button
      v-else
      type="button"
      class="group flex items-center gap-1.5"
      aria-label="Rename plan"
      title="Rename plan"
      @click="startEditing"
    >
      <h1 class="max-w-72 truncate text-sm font-semibold">{{ planName }}</h1>
      <Pencil
        :size="13"
        class="text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      />
    </button>

    <span aria-live="polite" class="flex items-center gap-1 text-xs">
      <template v-if="saveState === 'saving'">
        <LoaderCircle :size="13" class="text-ink-muted animate-spin" aria-hidden="true" />
        <span class="text-ink-muted">saving…</span>
      </template>
      <template v-else-if="saveState === 'error'">
        <TriangleAlert :size="13" class="text-danger" aria-hidden="true" />
        <span class="text-danger" :title="saveError ?? undefined">save failed</span>
      </template>
      <template v-else>
        <Check :size="13" class="text-ink-faint" aria-hidden="true" />
        <span class="text-ink-muted">saved</span>
      </template>
    </span>

    <div class="ml-auto flex items-center gap-1">
      <span class="text-ink-muted w-12 text-right text-xs tabular-nums">{{ zoomPercent }}%</span>
      <button
        type="button"
        class="text-ink-muted hover:bg-canvas hover:text-ink rounded p-1.5 transition-colors"
        title="Zoom to fit"
        aria-label="Zoom to fit"
        @click="emit('zoom-fit')"
      >
        <Maximize :size="15" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="text-ink-muted hover:bg-canvas hover:text-ink rounded px-2 py-1 text-xs font-medium transition-colors"
        title="Zoom to 100%"
        aria-label="Zoom to 100%"
        @click="emit('zoom-reset')"
      >
        100%
      </button>
      <span class="text-line select-none" aria-hidden="true">|</span>
      <button
        type="button"
        class="text-ink-muted hover:bg-canvas hover:text-ink flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors"
        title="Export"
        aria-label="Export plan"
        @click="emit('export')"
      >
        <Download :size="15" aria-hidden="true" />
        Export
      </button>
    </div>
  </header>
</template>
