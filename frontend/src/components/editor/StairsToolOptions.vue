<script setup lang="ts">
import { computed, ref } from 'vue'

import { formatInches, parseFeetInches } from '@/utils/units'

const WIDTH_TOLERANCE_IN = 1e-9

/** Common stair run widths (spec S6). */
const WIDTH_PRESETS_IN: readonly number[] = [30, 36, 42, 48]

const props = defineProps<{
  widthIn: number
  direction: 'up' | 'down'
}>()

const emit = defineEmits<{
  'set-width': [widthIn: number]
  'set-direction': [direction: 'up' | 'down']
}>()

const DIRECTION_OPTIONS: readonly { id: 'up' | 'down'; label: string }[] = [
  { id: 'up', label: 'Up' },
  { id: 'down', label: 'Down' },
]

const customText = ref('')
const customError = ref(false)

function isSelected(presetIn: number): boolean {
  return Math.abs(presetIn - props.widthIn) < WIDTH_TOLERANCE_IN
}

const isCustomWidth = computed(() => !WIDTH_PRESETS_IN.some((preset) => isSelected(preset)))

function applyCustom(): void {
  if (customText.value.trim() === '') {
    customError.value = false
    return
  }
  const parsed = parseFeetInches(customText.value)
  if (parsed === null || parsed <= 0) {
    customError.value = true
    return
  }
  customError.value = false
  customText.value = ''
  emit('set-width', parsed)
}
</script>

<template>
  <section aria-label="Stairs tool options" class="flex flex-col gap-4">
    <div>
      <h3 class="text-ink mb-2 text-xs font-semibold">Width</h3>
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Width presets">
        <button
          v-for="preset in WIDTH_PRESETS_IN"
          :key="preset"
          type="button"
          :aria-pressed="isSelected(preset)"
          class="rounded-md border px-2 py-1 text-xs transition-colors"
          :class="
            isSelected(preset)
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-line text-ink-muted hover:text-ink'
          "
          @click="emit('set-width', preset)"
        >
          {{ formatInches(preset) }}
        </button>
      </div>
      <label class="mt-2 block">
        <span class="text-ink-muted text-xs">Custom</span>
        <input
          v-model="customText"
          type="text"
          :placeholder="isCustomWidth ? formatInches(widthIn) : `e.g. 36 or 3'6`"
          class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 text-xs outline-none"
          :class="customError ? 'border-danger' : ''"
          :aria-invalid="customError"
          aria-label="Custom width in feet and inches"
          @keydown.enter.prevent="applyCustom"
          @blur="applyCustom"
        />
        <span v-if="customError" class="text-danger mt-1 block text-xs">
          Enter a width like 36" or 3'6
        </span>
      </label>
    </div>

    <div>
      <h3 class="text-ink mb-2 text-xs font-semibold">Direction</h3>
      <div
        class="border-line inline-flex overflow-hidden rounded-md border"
        role="group"
        aria-label="Stairs direction"
      >
        <button
          v-for="option in DIRECTION_OPTIONS"
          :key="option.id"
          type="button"
          :aria-pressed="option.id === direction"
          class="border-line px-2 py-1 text-xs transition-colors not-first:border-l"
          :class="
            option.id === direction ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink'
          "
          @click="emit('set-direction', option.id)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <p class="text-ink-faint text-xs">
      Tab flips the direction at any time; while dragging, type a length then Enter to place the far
      end exactly.
    </p>
  </section>
</template>
