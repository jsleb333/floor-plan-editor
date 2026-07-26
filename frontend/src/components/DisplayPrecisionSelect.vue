<script setup lang="ts">
import { computed } from 'vue'

import { DISPLAY_PRECISION_CHOICES_IN, formatInches } from '@/utils/units'

const props = defineProps<{
  /** The selected precision in inches (spec §5.9): 1, 1/2, 1/4 or 1/8. */
  modelValue: number
}>()

const emit = defineEmits<{
  'update:modelValue': [precisionIn: number]
}>()

/** The standard choices, plus the current value when it is non-standard. */
const choices = computed<readonly number[]>(() =>
  DISPLAY_PRECISION_CHOICES_IN.includes(props.modelValue)
    ? DISPLAY_PRECISION_CHOICES_IN
    : [...DISPLAY_PRECISION_CHOICES_IN, props.modelValue],
)

function handleChange(event: Event): void {
  if (!(event.target instanceof HTMLSelectElement)) return
  emit('update:modelValue', Number.parseFloat(event.target.value))
}
</script>

<template>
  <select
    :value="String(modelValue)"
    aria-label="Display precision"
    class="border-line focus:border-accent w-full rounded-md border bg-transparent px-2 py-1 outline-none"
    @change="handleChange"
  >
    <option v-for="choice in choices" :key="choice" :value="String(choice)">
      {{ formatInches(choice, choice) }}
    </option>
  </select>
</template>
