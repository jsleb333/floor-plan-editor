<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'
import { ref, watch } from 'vue'

import { useDisplayPrecision } from '@/composables/useDisplayPrecision'
import type { Stairs } from '@/types/plan'
import { formatFeetInches, parseFeetInches } from '@/utils/units'

const props = defineProps<{
  stairs: Stairs
}>()

const emit = defineEmits<{
  /** Whole-stairs replacement — the page dispatches ONE updateStairs (one undo step). */
  'update-stairs': [stairs: Stairs]
  'delete-stairs': []
}>()

const precisionIn = useDisplayPrecision()

const DIRECTION_OPTIONS: readonly { id: 'up' | 'down'; label: string }[] = [
  { id: 'up', label: 'Up' },
  { id: 'down', label: 'Down' },
]

const widthDraft = ref('')
const lengthDraft = ref('')
const rotationDraft = ref('')
const inputError = ref(false)

function update(patch: Partial<Stairs>): void {
  emit('update-stairs', { ...props.stairs, ...patch })
}

function applyLengthField(field: 'width_in' | 'length_in', draft: string): string {
  if (draft.trim() === '') {
    inputError.value = false
    return draft
  }
  const parsed = parseFeetInches(draft)
  if (parsed === null || parsed <= 0) {
    inputError.value = true
    return draft
  }
  inputError.value = false
  update({ [field]: parsed })
  return ''
}

function applyWidth(): void {
  widthDraft.value = applyLengthField('width_in', widthDraft.value)
}

function applyLength(): void {
  lengthDraft.value = applyLengthField('length_in', lengthDraft.value)
}

function applyRotation(): void {
  if (rotationDraft.value.trim() === '') {
    inputError.value = false
    return
  }
  const parsed = Number.parseFloat(rotationDraft.value)
  if (!Number.isFinite(parsed)) {
    inputError.value = true
    return
  }
  inputError.value = false
  rotationDraft.value = ''
  update({ rotation_deg: parsed })
}

watch(
  () => props.stairs.id,
  () => {
    widthDraft.value = ''
    lengthDraft.value = ''
    rotationDraft.value = ''
    inputError.value = false
  },
)
</script>

<template>
  <section aria-label="Stairs inspector" class="flex flex-col gap-4 text-xs">
    <header>
      <h3 class="text-ink text-sm font-semibold">Stairs</h3>
      <p class="text-ink-muted tabular-nums">
        {{ formatFeetInches(stairs.width_in, precisionIn) }} ×
        {{ formatFeetInches(stairs.length_in, precisionIn) }} · {{ stairs.direction }}
      </p>
    </header>

    <p
      v-if="inputError"
      role="alert"
      class="bg-danger-soft text-danger rounded-md px-2 py-1.5 leading-snug"
    >
      Enter a length like 3'0 or 36, and rotation in degrees.
    </p>

    <label class="block">
      <span class="text-ink font-semibold">Width</span>
      <input
        v-model="widthDraft"
        type="text"
        :placeholder="formatFeetInches(stairs.width_in, precisionIn)"
        class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 outline-none"
        aria-label="Stairs width in feet and inches"
        @keydown.enter.prevent="applyWidth"
        @blur="applyWidth"
      />
    </label>

    <label class="block">
      <span class="text-ink font-semibold">Length</span>
      <input
        v-model="lengthDraft"
        type="text"
        :placeholder="formatFeetInches(stairs.length_in, precisionIn)"
        class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 outline-none"
        aria-label="Stairs length in feet and inches"
        @keydown.enter.prevent="applyLength"
        @blur="applyLength"
      />
    </label>

    <label class="block">
      <span class="text-ink font-semibold">Rotation</span>
      <input
        v-model="rotationDraft"
        type="text"
        :placeholder="`${stairs.rotation_deg}°`"
        class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 outline-none"
        aria-label="Stairs rotation in degrees"
        @keydown.enter.prevent="applyRotation"
        @blur="applyRotation"
      />
    </label>

    <div>
      <h4 class="text-ink mb-1 font-semibold">Direction</h4>
      <div
        class="border-line inline-flex overflow-hidden rounded-md border"
        role="group"
        aria-label="Stairs direction"
      >
        <button
          v-for="option in DIRECTION_OPTIONS"
          :key="option.id"
          type="button"
          :aria-pressed="option.id === stairs.direction"
          class="border-line px-2 py-1 transition-colors not-first:border-l"
          :class="
            option.id === stairs.direction
              ? 'bg-accent-soft text-accent'
              : 'text-ink-muted hover:text-ink'
          "
          @click="update({ direction: option.id })"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <button
      type="button"
      class="border-danger/40 text-danger hover:bg-danger-soft flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
      @click="emit('delete-stairs')"
    >
      <Trash2 :size="13" aria-hidden="true" />
      Delete stairs
    </button>
  </section>
</template>
