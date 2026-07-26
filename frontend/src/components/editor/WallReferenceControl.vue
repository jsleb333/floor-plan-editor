<script setup lang="ts">
import type { WallReference } from '@/utils/geometry'

defineProps<{
  reference: WallReference
}>()

const emit = defineEmits<{
  'set-reference': [reference: WallReference]
  /** Hovered option for the live canvas preview; null on mouse-out (spec S1a). */
  'preview-reference': [reference: WallReference | null]
}>()

interface ReferenceOption {
  id: WallReference
  label: string
  /** Face-tint swatch class tying the option to its canvas colour (spec S1a). */
  swatch: string | null
}

const REFERENCE_OPTIONS: readonly ReferenceOption[] = [
  { id: 'center', label: 'Center', swatch: null },
  { id: 'left', label: 'Left face', swatch: 'bg-face-left' },
  { id: 'right', label: 'Right face', swatch: 'bg-face-right' },
]
</script>

<template>
  <div
    class="border-line inline-flex overflow-hidden rounded-md border"
    role="group"
    aria-label="Reference side"
    @mouseleave="emit('preview-reference', null)"
  >
    <button
      v-for="option in REFERENCE_OPTIONS"
      :key="option.id"
      type="button"
      :aria-pressed="option.id === reference"
      class="border-line inline-flex items-center gap-1.5 px-2 py-1 text-xs transition-colors not-first:border-l"
      :class="
        option.id === reference ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink'
      "
      @mouseenter="emit('preview-reference', option.id)"
      @click="emit('set-reference', option.id)"
    >
      <span
        v-if="option.swatch"
        class="inline-block size-2 rounded-full"
        :class="option.swatch"
        aria-hidden="true"
      />
      {{ option.label }}
    </button>
  </div>
</template>
