<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'

import { useDisplayPrecision } from '@/composables/useDisplayPrecision'
import type { Guide } from '@/types/plan'
import { formatFeetInches, parseFeetInches } from '@/utils/units'

/** How each anchoring reads in the Inspector (spec S9). */
const KIND_LABELS: Record<Guide['kind'], string> = {
  surface: 'Offset from wall',
  point: 'Through wall corner',
  free: 'Free line',
}

const props = defineProps<{
  guide: Guide
}>()

const emit = defineEmits<{
  /** Whole-guide replacement — the page dispatches ONE updateGuide (one undo step). */
  'update-guide': [guide: Guide]
  'delete-guide': []
}>()

const precisionIn = useDisplayPrecision()

const offsetDraft = ref('')
const offsetError = ref(false)
// Vue casts a `v-model` bound to `type="number"` to a number as soon as the
// text parses, so the angle draft holds either; the type keeps callers honest.
const angleDraft = ref<string | number>('')
const angleError = ref(false)

const kindLabel = computed(() => KIND_LABELS[props.guide.kind])

/** A surface guide is the only kind carrying an offset; the others carry an angle. */
const offsetIn = computed<number | null>(() =>
  props.guide.kind === 'surface' ? props.guide.offset_in : null,
)

const angleDeg = computed<number | null>(() =>
  props.guide.kind === 'surface' ? null : props.guide.angle_deg,
)

function applyOffset(): void {
  const guide = props.guide
  if (guide.kind !== 'surface') return
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
  emit('update-guide', { ...guide, offset_in: parsed })
}

function applyAngle(): void {
  const guide = props.guide
  if (guide.kind === 'surface') return
  const text = String(angleDraft.value).trim()
  if (text === '') {
    angleError.value = false
    return
  }
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) {
    angleError.value = true
    return
  }
  angleError.value = false
  angleDraft.value = ''
  emit('update-guide', { ...guide, angle_deg: parsed })
}

watch(
  () => props.guide.id,
  () => {
    offsetDraft.value = ''
    offsetError.value = false
    angleDraft.value = ''
    angleError.value = false
  },
)
</script>

<template>
  <section aria-label="Guide inspector" class="flex flex-col gap-4 text-xs">
    <header>
      <h3 class="text-ink text-sm font-semibold">Guide</h3>
      <p class="text-ink-muted">{{ kindLabel }}</p>
    </header>

    <label v-if="offsetIn !== null" class="block">
      <span class="text-ink font-semibold">Offset</span>
      <input
        v-model="offsetDraft"
        type="text"
        :placeholder="formatFeetInches(offsetIn, precisionIn)"
        class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 outline-none"
        :class="offsetError ? 'border-danger' : ''"
        :aria-invalid="offsetError"
        aria-label="Guide offset in feet and inches"
        @keydown.enter.prevent="applyOffset"
        @blur="applyOffset"
      />
      <span v-if="offsetError" class="text-danger mt-1 block">
        Enter a length like 36 or 3'0 (negative crosses to the wall's other side).
      </span>
    </label>

    <label v-if="angleDeg !== null" class="block">
      <span class="text-ink font-semibold">Angle</span>
      <input
        v-model="angleDraft"
        type="number"
        step="any"
        :placeholder="`${angleDeg}°`"
        class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 outline-none"
        :class="angleError ? 'border-danger' : ''"
        :aria-invalid="angleError"
        aria-label="Guide angle in degrees"
        @keydown.enter.prevent="applyAngle"
        @blur="applyAngle"
      />
      <span v-if="angleError" class="text-danger mt-1 block">
        Enter the angle in degrees, measured from the x axis.
      </span>
    </label>

    <button
      type="button"
      class="border-danger/40 text-danger hover:bg-danger-soft flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
      @click="emit('delete-guide')"
    >
      <Trash2 :size="13" aria-hidden="true" />
      Delete guide
    </button>
  </section>
</template>
