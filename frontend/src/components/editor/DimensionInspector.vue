<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'

import type { Dimension } from '@/types/plan'
import { distance } from '@/utils/geometry'
import { formatFeetInches, parseFeetInches } from '@/utils/units'

const props = defineProps<{
  dimension: Dimension
}>()

const emit = defineEmits<{
  /** Whole-dimension replacement — the page dispatches ONE updateDimension (one undo step). */
  'update-dimension': [dimension: Dimension]
  'delete-dimension': []
}>()

const offsetDraft = ref('')
const offsetError = ref(false)

const distanceLabel = computed(() =>
  formatFeetInches(distance(props.dimension.p1, props.dimension.p2)),
)

function pointLabel(point: { x: number; y: number }): string {
  return `${formatFeetInches(point.x)}, ${formatFeetInches(point.y)}`
}

function applyOffset(): void {
  if (offsetDraft.value.trim() === '') {
    offsetError.value = false
    return
  }
  const parsed = parseFeetInches(offsetDraft.value)
  if (parsed === null) {
    offsetError.value = true
    return
  }
  offsetError.value = false
  offsetDraft.value = ''
  emit('update-dimension', { ...props.dimension, offset_in: parsed })
}

watch(
  () => props.dimension.id,
  () => {
    offsetDraft.value = ''
    offsetError.value = false
  },
)
</script>

<template>
  <section aria-label="Dimension inspector" class="flex flex-col gap-4 text-xs">
    <header>
      <h3 class="text-ink text-sm font-semibold">Dimension</h3>
      <p class="text-ink-muted tabular-nums">{{ distanceLabel }}</p>
    </header>

    <div>
      <h4 class="text-ink mb-1 font-semibold">Endpoints</h4>
      <dl class="text-ink-muted flex flex-col gap-0.5 tabular-nums">
        <div class="flex justify-between gap-2">
          <dt>P1</dt>
          <dd>{{ pointLabel(dimension.p1) }}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt>P2</dt>
          <dd>{{ pointLabel(dimension.p2) }}</dd>
        </div>
      </dl>
    </div>

    <label class="block">
      <span class="text-ink font-semibold">Side offset</span>
      <input
        v-model="offsetDraft"
        type="text"
        :placeholder="formatFeetInches(dimension.offset_in)"
        class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 outline-none"
        :class="offsetError ? 'border-danger' : ''"
        :aria-invalid="offsetError"
        aria-label="Dimension side offset in feet and inches"
        @keydown.enter.prevent="applyOffset"
        @blur="applyOffset"
      />
      <span v-if="offsetError" class="text-danger mt-1 block">
        Enter a length like 12 or -1'0 (negative flips the side).
      </span>
    </label>

    <button
      type="button"
      class="border-danger/40 text-danger hover:bg-danger-soft flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
      @click="emit('delete-dimension')"
    >
      <Trash2 :size="13" aria-hidden="true" />
      Delete dimension
    </button>
  </section>
</template>
