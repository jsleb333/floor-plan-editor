<script setup lang="ts">
import { computed, ref } from 'vue'

import WallColorControl from '@/components/editor/WallColorControl.vue'
import WallReferenceControl from '@/components/editor/WallReferenceControl.vue'
import type { WallReference } from '@/utils/geometry'
import { formatInches, parseFeetInches } from '@/utils/units'
import { defaultWallColor, wallRoleOf } from '@/utils/wallColors'

const THICKNESS_TOLERANCE_IN = 1e-9

const props = defineProps<{
  presetsIn: readonly number[]
  thicknessIn: number
  reference: WallReference
  /** Colour the next wall is drawn with; null follows its role (spec S1f). */
  color: string | null
}>()

const emit = defineEmits<{
  'set-thickness': [thicknessIn: number]
  'set-reference': [reference: WallReference]
  'set-color': [color: string | null]
}>()

const customText = ref('')
const customError = ref(false)

function isSelected(presetIn: number): boolean {
  return Math.abs(presetIn - props.thicknessIn) < THICKNESS_TOLERANCE_IN
}

const isCustomThickness = computed(() => !props.presetsIn.some((preset) => isSelected(preset)))

const role = computed(() => wallRoleOf(props.thicknessIn, props.presetsIn))
const roleDefaultColor = computed(() => defaultWallColor(props.thicknessIn, props.presetsIn))

function presetRole(index: number): string {
  return index === 0 ? 'exterior' : 'interior'
}

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
  emit('set-thickness', parsed)
}
</script>

<template>
  <section aria-label="Wall tool options" class="flex flex-col gap-4">
    <div>
      <h3 class="text-ink mb-2 text-xs font-semibold">Thickness</h3>
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Thickness presets">
        <button
          v-for="(preset, index) in presetsIn"
          :key="preset"
          type="button"
          :aria-pressed="isSelected(preset)"
          class="rounded-md border px-2 py-1 text-xs transition-colors"
          :class="
            isSelected(preset)
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-line text-ink-muted hover:text-ink'
          "
          @click="emit('set-thickness', preset)"
        >
          {{ formatInches(preset) }}
          <span class="text-ink-faint ml-0.5">{{ presetRole(index) }}</span>
        </button>
      </div>
      <label class="mt-2 block">
        <span class="text-ink-muted text-xs">Custom</span>
        <input
          v-model="customText"
          type="text"
          :placeholder="isCustomThickness ? formatInches(thicknessIn) : `e.g. 5 1/2&quot;`"
          class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 text-xs outline-none"
          :class="customError ? 'border-danger' : ''"
          :aria-invalid="customError"
          aria-label="Custom thickness in feet and inches"
          @keydown.enter.prevent="applyCustom"
          @blur="applyCustom"
        />
        <span v-if="customError" class="text-danger mt-1 block text-xs">
          Enter a length like 5 1/2" or 0'6
        </span>
      </label>
    </div>

    <div>
      <h3 class="text-ink mb-2 text-xs font-semibold">Colour</h3>
      <WallColorControl
        :color="color"
        :default-color="roleDefaultColor"
        :default-label="role"
        @set-color="emit('set-color', $event)"
      />
    </div>

    <div>
      <h3 class="text-ink mb-2 text-xs font-semibold">Reference side</h3>
      <WallReferenceControl :reference="reference" @set-reference="emit('set-reference', $event)" />
      <p class="text-ink-faint mt-1.5 text-xs">Tab cycles the side while drawing.</p>
    </div>
  </section>
</template>
