<script setup lang="ts">
import { computed, ref } from 'vue'

import type { DoorStyle } from '@/types/plan'
import { DOOR_STYLE_OPTIONS, doorStyleControls } from '@/utils/doorStyles'
import { formatInches, parseFeetInches } from '@/utils/units'

const WIDTH_TOLERANCE_IN = 1e-9

const props = defineProps<{
  kind: 'door' | 'window'
  widthIn: number
  /** Width presets for the current kind, resolved from the plan document (spec §5.9 tier 2). */
  presetsIn: readonly number[]
  /**
   * Leaf style of the next door (spec S4); ignored for windows. Named
   * `doorStyle` because `style` is a reserved attribute on a component.
   */
  doorStyle: DoorStyle
  hinge: 'left' | 'right'
  swing: 'in' | 'out'
}>()

const emit = defineEmits<{
  'set-width': [widthIn: number]
  'set-style': [style: DoorStyle]
  'set-hinge': [hinge: 'left' | 'right']
  'set-swing': [swing: 'in' | 'out']
  /** A committed custom width that isn't already a preset; the caller grows the plan's list. */
  'add-width-preset': [widthIn: number]
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

/** The side fields the armed style reads, with their per-style labels (spec S4). */
const controls = computed(() => doorStyleControls(props.doorStyle))

const keyboardHint = computed(() => {
  if (props.kind !== 'door') return 'Typed digits set the width exactly while hovering.'
  const gestures: string[] = []
  if (controls.value.swing) {
    gestures.push(`the ${controls.value.swing.toLowerCase()} follows the cursor across the wall`)
  }
  if (controls.value.hinge) {
    gestures.push(`Tab cycles the ${controls.value.hinge.toLowerCase()}`)
  }
  return `While hovering: ${[...gestures, 'and typed digits set the width exactly'].join(', ')}.`
})

function isSelected(presetIn: number, widthIn: number = props.widthIn): boolean {
  return Math.abs(presetIn - widthIn) < WIDTH_TOLERANCE_IN
}

const isCustomWidth = computed(() => !props.presetsIn.some((preset) => isSelected(preset)))

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
  if (!props.presetsIn.some((preset) => isSelected(preset, parsed))) {
    emit('add-width-preset', parsed)
  }
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

    <div v-if="kind === 'door'">
      <h3 class="text-ink mb-2 text-xs font-semibold">Style</h3>
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Door style">
        <button
          v-for="option in DOOR_STYLE_OPTIONS"
          :key="option.id"
          type="button"
          :aria-pressed="option.id === doorStyle"
          class="rounded-md border px-2 py-1 text-xs transition-colors"
          :class="
            option.id === doorStyle
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-line text-ink-muted hover:text-ink'
          "
          @click="emit('set-style', option.id)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <div v-if="kind === 'door' && (controls.hinge || controls.swing)" class="flex gap-4">
      <div v-if="controls.hinge">
        <h3 class="text-ink mb-2 text-xs font-semibold">{{ controls.hinge }}</h3>
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
      <div v-if="controls.swing">
        <h3 class="text-ink mb-2 text-xs font-semibold">{{ controls.swing }}</h3>
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
