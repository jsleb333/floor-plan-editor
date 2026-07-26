<script setup lang="ts">
import { ImageUp, PenLine } from 'lucide-vue-next'
import { ref } from 'vue'

import { useUnderlayImport } from '@/composables/useUnderlayImport'

const emit = defineEmits<{
  'start-drawing': []
}>()

const { uploading, error, importFile } = useUnderlayImport()

const fileInput = ref<HTMLInputElement | null>(null)

function onFileChange(event: Event): void {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || !input.files?.length) return
  void importFile(input.files[0])
  input.value = ''
}
</script>

<template>
  <section
    class="border-line bg-surface shadow-panel absolute top-1/2 left-1/2 w-72 -translate-x-1/2 -translate-y-1/2 rounded-lg border p-5 text-center"
  >
    <h2 class="text-ink text-sm font-semibold">This plan is empty</h2>
    <p class="text-ink-muted mt-1 text-xs leading-relaxed">
      The wall tool is ready — or start from a photo of an existing plan.
    </p>
    <div class="mt-4 flex flex-col gap-2">
      <button
        type="button"
        class="border-line text-ink-muted hover:border-accent hover:text-ink flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs transition-colors"
        :disabled="uploading"
        @click="fileInput?.click()"
      >
        <ImageUp :size="14" aria-hidden="true" />
        {{ uploading ? 'Uploading…' : 'Import a photo to trace' }}
      </button>
      <button
        type="button"
        class="bg-accent hover:bg-accent-strong flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium text-white transition-colors"
        @click="emit('start-drawing')"
      >
        <PenLine :size="14" aria-hidden="true" />
        Start drawing walls
      </button>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="image/jpeg,image/png"
      class="hidden"
      aria-label="Underlay image file"
      @change="onFileChange"
    />
    <p
      v-if="error"
      role="alert"
      class="bg-danger-soft text-danger mt-3 rounded-md px-2 py-1.5 text-xs"
    >
      {{ error }}
    </p>
  </section>
</template>
