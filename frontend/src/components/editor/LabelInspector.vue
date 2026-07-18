<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'
import { onMounted, ref, watch } from 'vue'

import type { Label } from '@/types/plan'

/** Font size presets in inches of plan space (spec S7). */
const SIZE_PRESETS_IN = [6, 8, 12]

const props = defineProps<{
  label: Label
  /** Focus and select the text input on mount (right after placement, spec S7). */
  autofocus?: boolean
}>()

const emit = defineEmits<{
  /** Whole-label replacement — the page dispatches ONE updateLabel (one undo step). */
  'update-label': [label: Label]
  'delete-label': []
}>()

const textInput = ref<HTMLInputElement | null>(null)
const textDraft = ref(props.label.text)

function update(patch: Partial<Label>): void {
  emit('update-label', { ...props.label, ...patch })
}

function applyText(): void {
  if (textDraft.value === props.label.text) return
  update({ text: textDraft.value })
}

watch(
  () => props.label.id,
  () => {
    textDraft.value = props.label.text
    if (props.autofocus) {
      textInput.value?.focus()
      textInput.value?.select()
    }
  },
)

watch(
  () => props.label.text,
  (text) => {
    if (textInput.value !== document.activeElement) textDraft.value = text
  },
)

onMounted(() => {
  if (props.autofocus) {
    textInput.value?.focus()
    textInput.value?.select()
  }
})
</script>

<template>
  <section aria-label="Label inspector" class="flex flex-col gap-4 text-xs">
    <header>
      <h3 class="text-ink text-sm font-semibold">Label</h3>
    </header>

    <label class="block">
      <span class="text-ink font-semibold">Text</span>
      <input
        ref="textInput"
        v-model="textDraft"
        type="text"
        class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 outline-none"
        aria-label="Label text"
        @input="applyText"
        @keydown.enter.prevent="applyText"
        @blur="applyText"
      />
    </label>

    <div>
      <h4 class="text-ink mb-1 font-semibold">Size</h4>
      <div class="flex gap-1.5" role="group" aria-label="Label size presets">
        <button
          v-for="preset in SIZE_PRESETS_IN"
          :key="preset"
          type="button"
          :aria-pressed="preset === label.size_in"
          class="rounded-md border px-2 py-1 transition-colors"
          :class="
            preset === label.size_in
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-line text-ink-muted hover:text-ink'
          "
          @click="update({ size_in: preset })"
        >
          {{ preset }}"
        </button>
      </div>
    </div>

    <button
      type="button"
      class="border-danger/40 text-danger hover:bg-danger-soft flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
      @click="emit('delete-label')"
    >
      <Trash2 :size="13" aria-hidden="true" />
      Delete label
    </button>
  </section>
</template>
