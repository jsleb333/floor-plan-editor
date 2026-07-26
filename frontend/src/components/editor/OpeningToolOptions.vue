<script setup lang="ts">
import { computed, ref } from 'vue'

import { formatInches, parseFeetInches } from '@/utils/units'

const WIDTH_TOLERANCE_IN = 1e-9

/** Common door leaf widths (spec S4). */
const DOOR_WIDTH_PRESETS_IN: readonly number[] = [24, 28, 30, 32, 36]
/** Common window widths (spec S5). */
const WINDOW_WIDTH_PRESETS_IN: readonly number[] = [24, 36, 48, 60, 72]

const props = defineProps<{
  kind: 'door' | 'window'
  widthIn: number
  hinge: 'left' | 'right'
  swing: 'in' | 'out'
}>()

const emit = defineEmits<{
  'set-width': [widthIn: number]
  'set-hinge': [hinge: 'left' | 'right']
  'set-swing': [swing: 'in' | 'out']
}>()

const HINGE_OPTIONS: readonly { id: 'left' | 'right'; label: string }[] = [
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
]

const SWING_OPTIONS: readonly { id: 'in' | 'out'; label: string }[] = [
  { id: 'in', label: 'In' },
  { id: 'out', label: 'Out' },
]

const customText = ref('')
const customError = ref(false)

const title = computed(() => (props.kind === 'door' ? 'Door' : 'Window'))

const presetsIn = computed(() =>
  props.kind === 'door' ? DOOR_WIDTH_PRESETS_IN : WINDOW_WIDTH_PRESETS_IN,
)

const keyboardHint = computed(() =>
  props.kind === 'door'
    ? 'While hovering: the swing follows the cursor across the wall, Tab cycles the hinge, and typed digits set the width exactly.'
    : 'Typed digits set the width exactly while hovering.',
)

function isSelected(presetIn: number): boolean {
  return Math.abs(presetIn - props.widthIn) < WIDTH_TOLERANCE_IN
}

const isCustomWidth = computed(() => !presetsIn.value.some((preset) => isSelected(preset)))

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
  <section :aria-label="`${title} tool options`" class="flex flex-col gap-4">
    <div>
      <h3 class="text-ink mb-2 text-xs font-semibold">Width</h3>
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Width presets">
        <button
          v-for="preset in presetsIn"
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
          :placeholder="isCustomWidth ? formatInches(widthIn) : `e.g. 30 or 2'6`"
          class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 text-xs outline-none"
          :class="customError ? 'border-danger' : ''"
          :aria-invalid="customError"
          aria-label="Custom width in feet and inches"
          @keydown.enter.prevent="applyCustom"
          @blur="applyCustom"
        />
        <span v-if="customError" class="text-danger mt-1 block text-xs">
          Enter a width like 30" or 2'6
        </span>
      </label>
    </div>

    <div v-if="kind === 'door'" class="flex gap-4">
      <div>
        <h3 class="text-ink mb-2 text-xs font-semibold">Hinge</h3>
        <div
          class="border-line inline-flex overflow-hidden rounded-md border"
          role="group"
          aria-label="Hinge side"
        >
          <button
            v-for="option in HINGE_OPTIONS"
            :key="option.id"
            type="button"
            :aria-pressed="option.id === hinge"
            class="border-line px-2 py-1 text-xs transition-colors not-first:border-l"
            :class="
              option.id === hinge ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink'
            "
            @click="emit('set-hinge', option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <div>
        <h3 class="text-ink mb-2 text-xs font-semibold">Swing</h3>
        <div
          class="border-line inline-flex overflow-hidden rounded-md border"
          role="group"
          aria-label="Swing direction"
        >
          <button
            v-for="option in SWING_OPTIONS"
            :key="option.id"
            type="button"
            :aria-pressed="option.id === swing"
            class="border-line px-2 py-1 text-xs transition-colors not-first:border-l"
            :class="
              option.id === swing ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink'
            "
            @click="emit('set-swing', option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
    </div>

    <p class="text-ink-faint text-xs">{{ keyboardHint }}</p>
  </section>
</template>
