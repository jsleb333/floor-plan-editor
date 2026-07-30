<script setup lang="ts">
import { computed } from 'vue'

import { WALL_COLOR_PALETTE } from '@/utils/wallColors'

const props = defineProps<{
  /** The wall's colour override, or null while it follows its role default. */
  color: string | null
  /** The colour the wall draws in when `color` is null (spec S1f). */
  defaultColor: string
  /** Name of the role supplying that default, shown on the "Default" option. */
  defaultLabel: string
}>()

const emit = defineEmits<{
  /** A colour pick, or null to fall back to the role default. */
  'set-color': [color: string | null]
}>()

const effective = computed(() => props.color ?? props.defaultColor)

function isSelected(swatch: string): boolean {
  return props.color !== null && props.color.toLowerCase() === swatch.toLowerCase()
}

function onCustomInput(event: Event): void {
  if (event.target instanceof HTMLInputElement) emit('set-color', event.target.value)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Wall colour">
      <button
        type="button"
        :aria-pressed="color === null"
        class="rounded-md border px-2 py-1 text-xs transition-colors"
        :class="
          color === null
            ? 'border-accent bg-accent-soft text-accent'
            : 'border-line text-ink-muted hover:text-ink'
        "
        :title="`Follow the ${defaultLabel} default`"
        @click="emit('set-color', null)"
      >
        <span
          class="mr-1 inline-block size-2 rounded-full align-middle"
          :style="{ backgroundColor: defaultColor }"
          aria-hidden="true"
        />
        Default
      </button>

      <button
        v-for="swatch in WALL_COLOR_PALETTE"
        :key="swatch"
        type="button"
        :aria-pressed="isSelected(swatch)"
        :aria-label="`Wall colour ${swatch}`"
        class="size-6 rounded-md border transition-transform hover:scale-110"
        :class="isSelected(swatch) ? 'border-accent ring-accent ring-2' : 'border-line'"
        :style="{ backgroundColor: swatch }"
        @click="emit('set-color', swatch)"
      />

      <label
        class="border-line relative size-6 shrink-0 cursor-pointer rounded-md border"
        :style="{ backgroundColor: effective }"
        aria-label="Custom wall colour"
        title="Custom colour"
      >
        <input
          type="color"
          :value="effective"
          class="absolute inset-0 size-full cursor-pointer opacity-0"
          @input="onCustomInput"
        />
      </label>
    </div>

    <p class="text-ink-faint text-xs">
      {{
        color === null
          ? `Following the ${defaultLabel} default — thickness picks it.`
          : 'Custom colour — thickness no longer changes it.'
      }}
    </p>
  </div>
</template>
