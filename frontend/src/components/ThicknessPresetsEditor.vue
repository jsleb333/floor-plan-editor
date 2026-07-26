<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next'
import { ref, watch } from 'vue'

import { formatInches, parseFeetInches } from '@/utils/units'

/** Value a freshly added preset row starts at (the standard interior default). */
const NEW_PRESET_IN = 3.5

const props = defineProps<{
  /** Wall thickness presets in inches, ordered exterior first (spec §5.9 tier 2). */
  presetsIn: readonly number[]
}>()

const emit = defineEmits<{
  change: [presetsIn: number[]]
}>()

const drafts = ref<string[]>(props.presetsIn.map((preset) => formatInches(preset)))

watch(
  () => props.presetsIn,
  (presets) => {
    drafts.value = presets.map((preset) => formatInches(preset))
  },
)

function commitDraft(index: number): void {
  const parsed = parseFeetInches(drafts.value[index] ?? '')
  if (parsed === null || parsed <= 0) {
    drafts.value[index] = formatInches(props.presetsIn[index])
    return
  }
  if (parsed === props.presetsIn[index]) {
    drafts.value[index] = formatInches(parsed)
    return
  }
  const next = [...props.presetsIn]
  next[index] = parsed
  emit('change', next)
}

function removePreset(index: number): void {
  emit(
    'change',
    props.presetsIn.filter((_, i) => i !== index),
  )
}

function addPreset(): void {
  emit('change', [...props.presetsIn, NEW_PRESET_IN])
}
</script>

<template>
  <div class="flex flex-col gap-1" role="group" aria-label="Wall thickness presets">
    <div
      v-for="(preset, index) in presetsIn"
      :key="index"
      class="border-line flex items-center gap-1 rounded-md border px-1.5 py-0.5"
    >
      <input
        v-model="drafts[index]"
        type="text"
        class="focus:border-accent min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 outline-none"
        :aria-label="`Thickness preset ${index + 1}`"
        @keydown.enter.prevent="commitDraft(index)"
        @blur="commitDraft(index)"
      />
      <button
        v-if="presetsIn.length > 1"
        type="button"
        class="text-ink-faint hover:text-danger rounded p-0.5 transition-colors"
        :aria-label="`Remove preset ${formatInches(preset)}`"
        @click="removePreset(index)"
      >
        <X :size="12" aria-hidden="true" />
      </button>
    </div>
    <button
      type="button"
      class="text-ink-muted hover:text-ink flex items-center gap-1 self-start rounded px-1 py-0.5 transition-colors"
      @click="addPreset"
    >
      <Plus :size="12" aria-hidden="true" />
      Add preset
    </button>
  </div>
</template>
