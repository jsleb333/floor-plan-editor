<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'

import { useDisplayPrecision } from '@/composables/useDisplayPrecision'
import type { Opening, Wall } from '@/types/plan'
import { DOOR_STYLE_OPTIONS, doorStyleControls } from '@/utils/doorStyles'
import { clampOpeningT, wallSegmentSpan } from '@/utils/geometry'
import { formatFeetInches, parseFeetInches } from '@/utils/units'

const props = defineProps<{
  opening: Opening
  /** All walls, to resolve the opening's host segment. */
  walls: readonly Wall[]
}>()

const emit = defineEmits<{
  /** Whole-opening replacement — the page dispatches ONE updateOpening (one undo step). */
  'update-opening': [opening: Opening]
  'delete-opening': []
}>()

const precisionIn = useDisplayPrecision()

const HINGE_OPTIONS: readonly { id: 'left' | 'right'; label: string }[] = [
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
]

const SWING_OPTIONS: readonly { id: 'in' | 'out'; label: string }[] = [
  { id: 'in', label: 'In' },
  { id: 'out', label: 'Out' },
]

/** The side fields the opening's style reads, with their per-style labels (spec S4). */
const controls = computed(() => doorStyleControls(props.opening.style))

const widthDraft = ref('')
const widthError = ref(false)
const offsetDrafts = ref<{ start: string; end: string }>({ start: '', end: '' })
const offsetError = ref(false)

const hostSpan = computed(() => {
  const wall = props.walls.find((candidate) => candidate.id === props.opening.wall_id)
  return wall ? wallSegmentSpan(wall, props.opening.segment_index) : null
})

const clampedT = computed(() => {
  const span = hostSpan.value
  if (!span) return props.opening.t
  return clampOpeningT(props.opening.t, props.opening.width_in, span.lengthIn)
})

const segmentLengthLabel = computed(() =>
  hostSpan.value ? formatFeetInches(hostSpan.value.lengthIn, precisionIn.value) : '—',
)

/** Distance from each segment end to the opening's near edge (spec S2a spirit). */
const edgeOffsets = computed(() => {
  const span = hostSpan.value
  if (!span) return null
  const half = Math.min(props.opening.width_in, span.lengthIn) / 2
  return {
    start: clampedT.value - half,
    end: span.lengthIn - (clampedT.value + half),
  }
})

function update(patch: Partial<Opening>): void {
  emit('update-opening', { ...props.opening, ...patch })
}

function applyWidth(): void {
  if (widthDraft.value.trim() === '') {
    widthError.value = false
    return
  }
  const parsed = parseFeetInches(widthDraft.value)
  if (parsed === null || parsed <= 0) {
    widthError.value = true
    return
  }
  widthError.value = false
  widthDraft.value = ''
  const span = hostSpan.value
  const t = span ? clampOpeningT(props.opening.t, parsed, span.lengthIn) : props.opening.t
  update({ width_in: parsed, t })
}

/** Repositions the opening so its edge sits exactly `typed` from the segment end. */
function applyEdgeOffset(side: 'start' | 'end'): void {
  const draft = offsetDrafts.value[side]
  if (draft.trim() === '') {
    offsetError.value = false
    return
  }
  const typed = parseFeetInches(draft)
  const span = hostSpan.value
  if (typed === null || typed < 0 || !span) {
    offsetError.value = true
    return
  }
  offsetError.value = false
  offsetDrafts.value = { ...offsetDrafts.value, [side]: '' }
  const half = props.opening.width_in / 2
  const t = side === 'start' ? typed + half : span.lengthIn - typed - half
  update({ t: clampOpeningT(t, props.opening.width_in, span.lengthIn) })
}

watch(
  () => props.opening.id,
  () => {
    widthDraft.value = ''
    widthError.value = false
    offsetDrafts.value = { start: '', end: '' }
    offsetError.value = false
  },
)
</script>

<template>
  <section aria-label="Opening inspector" class="flex flex-col gap-4 text-xs">
    <header>
      <h3 class="text-ink text-sm font-semibold capitalize">{{ opening.kind }}</h3>
      <p class="text-ink-muted tabular-nums">
        {{ formatFeetInches(opening.width_in, precisionIn) }} wide · segment
        {{ opening.segment_index + 1 }} ({{ segmentLengthLabel }})
      </p>
    </header>

    <label class="block">
      <span class="text-ink font-semibold">Width</span>
      <input
        v-model="widthDraft"
        type="text"
        :placeholder="formatFeetInches(opening.width_in, precisionIn)"
        class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 outline-none"
        :class="widthError ? 'border-danger' : ''"
        :aria-invalid="widthError"
        aria-label="Opening width in feet and inches"
        @keydown.enter.prevent="applyWidth"
        @blur="applyWidth"
      />
    </label>

    <div v-if="opening.kind === 'door'">
      <h4 class="text-ink mb-1 font-semibold">Style</h4>
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Door style">
        <button
          v-for="option in DOOR_STYLE_OPTIONS"
          :key="option.id"
          type="button"
          :aria-pressed="option.id === opening.style"
          class="rounded-md border px-2 py-1 transition-colors"
          :class="
            option.id === opening.style
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-line text-ink-muted hover:text-ink'
          "
          @click="update({ style: option.id })"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <div v-if="opening.kind === 'door' && (controls.hinge || controls.swing)" class="flex gap-4">
      <div v-if="controls.hinge">
        <h4 class="text-ink mb-1 font-semibold">{{ controls.hinge }}</h4>
        <div
          class="border-line inline-flex overflow-hidden rounded-md border"
          role="group"
          aria-label="Hinge side"
        >
          <button
            v-for="option in HINGE_OPTIONS"
            :key="option.id"
            type="button"
            :aria-pressed="option.id === opening.hinge"
            class="border-line px-2 py-1 transition-colors not-first:border-l"
            :class="
              option.id === opening.hinge
                ? 'bg-accent-soft text-accent'
                : 'text-ink-muted hover:text-ink'
            "
            @click="update({ hinge: option.id })"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <div v-if="controls.swing">
        <h4 class="text-ink mb-1 font-semibold">{{ controls.swing }}</h4>
        <div
          class="border-line inline-flex overflow-hidden rounded-md border"
          role="group"
          aria-label="Swing direction"
        >
          <button
            v-for="option in SWING_OPTIONS"
            :key="option.id"
            type="button"
            :aria-pressed="option.id === opening.swing"
            class="border-line px-2 py-1 transition-colors not-first:border-l"
            :class="
              option.id === opening.swing
                ? 'bg-accent-soft text-accent'
                : 'text-ink-muted hover:text-ink'
            "
            @click="update({ swing: option.id })"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="edgeOffsets">
      <h4 class="text-ink mb-2 font-semibold">Offsets from segment ends</h4>
      <p
        v-if="offsetError"
        role="alert"
        class="bg-danger-soft text-danger mb-2 rounded-md px-2 py-1.5 leading-snug"
      >
        Enter a distance like 2'6 or 18.
      </p>
      <div class="flex flex-col gap-1">
        <label class="border-line flex items-center gap-2 rounded-md border px-2 py-1">
          <span class="text-ink-muted w-10">Start</span>
          <span class="text-ink w-16 tabular-nums">{{
            formatFeetInches(edgeOffsets.start, precisionIn)
          }}</span>
          <input
            v-model="offsetDrafts.start"
            type="text"
            :placeholder="formatFeetInches(edgeOffsets.start, precisionIn)"
            class="border-line focus:border-accent min-w-0 flex-1 rounded border px-1.5 py-0.5 outline-none"
            aria-label="Distance from segment start to the opening edge"
            @keydown.enter.prevent="applyEdgeOffset('start')"
          />
        </label>
        <label class="border-line flex items-center gap-2 rounded-md border px-2 py-1">
          <span class="text-ink-muted w-10">End</span>
          <span class="text-ink w-16 tabular-nums">{{
            formatFeetInches(edgeOffsets.end, precisionIn)
          }}</span>
          <input
            v-model="offsetDrafts.end"
            type="text"
            :placeholder="formatFeetInches(edgeOffsets.end, precisionIn)"
            class="border-line focus:border-accent min-w-0 flex-1 rounded border px-1.5 py-0.5 outline-none"
            aria-label="Distance from segment end to the opening edge"
            @keydown.enter.prevent="applyEdgeOffset('end')"
          />
        </label>
      </div>
    </div>

    <button
      type="button"
      class="border-danger/40 text-danger hover:bg-danger-soft flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
      @click="emit('delete-opening')"
    >
      <Trash2 :size="13" aria-hidden="true" />
      Delete {{ opening.kind }}
    </button>
  </section>
</template>
