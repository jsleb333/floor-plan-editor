<script setup lang="ts">
import { ArrowLeftRight, Lock, LockOpen, Trash2 } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import WallColorControl from '@/components/editor/WallColorControl.vue'
import WallReferenceControl from '@/components/editor/WallReferenceControl.vue'
import { useDisplayPrecision } from '@/composables/useDisplayPrecision'
import type { Wall } from '@/types/plan'
import { distance, segmentCountOf, setSegmentLength } from '@/utils/geometry'
import type { WallReference } from '@/utils/geometry'
import { formatFeetInches, parseFeetInches } from '@/utils/units'
import { defaultWallColor, wallRoleOf } from '@/utils/wallColors'

const THICKNESS_TOLERANCE_IN = 1e-9
const EIGHTHS_PER_INCH = 8
const NOTICE_TIMEOUT_MS = 6000

const props = defineProps<{
  wall: Wall
  thicknessPresetsIn: readonly number[]
}>()

const emit = defineEmits<{
  /** Whole-wall replacement — the page dispatches ONE updateWall (one undo step). */
  'update-wall': [wall: Wall]
  'delete-wall': []
  /** Blocking locked segments to flash on the canvas (spec S3b). */
  'flash-segments': [segments: number[]]
  /**
   * Transient would-be wall for the live canvas preview while hovering the
   * reference-side options or swap button; null releases it (spec S1a). Never
   * enters the document or the undo history.
   */
  'preview-wall': [wall: Wall | null]
}>()

const precisionIn = useDisplayPrecision()

type Notice = { kind: 'error' | 'info'; text: string } | null

const customThicknessText = ref('')
const customThicknessError = ref(false)
const lengthDrafts = ref<Record<number, string>>({})
const notice = ref<Notice>(null)
let noticeTimer: ReturnType<typeof setTimeout> | null = null

interface SegmentRow {
  index: number
  lengthIn: number
  label: string
  locked: boolean
}

const segments = computed<SegmentRow[]>(() => {
  const n = props.wall.vertices.length
  const count = segmentCountOf(n, props.wall.closed)
  const rows: SegmentRow[] = []
  for (let i = 0; i < count; i++) {
    const lengthIn = distance(props.wall.vertices[i], props.wall.vertices[(i + 1) % n])
    rows.push({
      index: i,
      lengthIn,
      label: formatFeetInches(lengthIn, precisionIn.value),
      locked: props.wall.locked_segments.includes(i),
    })
  }
  return rows
})

const totalLengthLabel = computed(() =>
  formatFeetInches(
    segments.value.reduce((sum, row) => sum + row.lengthIn, 0),
    precisionIn.value,
  ),
)

const allLocked = computed(
  () => segments.value.length > 0 && segments.value.every((row) => row.locked),
)

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b)
}

/** Inches-only label for thickness values, e.g. `12"`, `4 1/2"`, `3 1/2"`. */
function inchesLabel(valueIn: number): string {
  const totalEighths = Math.round(valueIn * EIGHTHS_PER_INCH)
  const whole = Math.floor(totalEighths / EIGHTHS_PER_INCH)
  const numerator = totalEighths - whole * EIGHTHS_PER_INCH
  if (numerator === 0) return `${whole}"`
  const divisor = greatestCommonDivisor(numerator, EIGHTHS_PER_INCH)
  const fraction = `${numerator / divisor}/${EIGHTHS_PER_INCH / divisor}`
  return whole > 0 ? `${whole} ${fraction}"` : `${fraction}"`
}

function isThicknessSelected(presetIn: number): boolean {
  return Math.abs(presetIn - props.wall.thickness_in) < THICKNESS_TOLERANCE_IN
}

function setNotice(next: Notice): void {
  notice.value = next
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = null
  if (next) {
    noticeTimer = setTimeout(() => {
      noticeTimer = null
      notice.value = null
    }, NOTICE_TIMEOUT_MS)
  }
}

const role = computed(() => wallRoleOf(props.wall.thickness_in, props.thicknessPresetsIn))
const roleDefaultColor = computed(() =>
  defaultWallColor(props.wall.thickness_in, props.thicknessPresetsIn),
)

function setColor(color: string | null): void {
  if (color === props.wall.color) return
  emit('update-wall', { ...props.wall, color })
}

function setThickness(thicknessIn: number): void {
  if (Math.abs(thicknessIn - props.wall.thickness_in) < THICKNESS_TOLERANCE_IN) return
  emit('update-wall', { ...props.wall, thickness_in: thicknessIn })
}

function applyCustomThickness(): void {
  if (customThicknessText.value.trim() === '') {
    customThicknessError.value = false
    return
  }
  const parsed = parseFeetInches(customThicknessText.value)
  if (parsed === null || parsed <= 0) {
    customThicknessError.value = true
    return
  }
  customThicknessError.value = false
  customThicknessText.value = ''
  setThickness(parsed)
}

/** Whether a hover preview is currently shown on the canvas (spec S1a). */
let previewShown = false

function emitPreview(wall: Wall | null): void {
  if (wall === null && !previewShown) return
  previewShown = wall !== null
  emit('preview-wall', wall)
}

function setReference(reference: WallReference): void {
  emitPreview(null)
  if (reference === props.wall.reference) return
  emit('update-wall', { ...props.wall, reference })
}

function previewReference(reference: WallReference | null): void {
  if (reference === null || reference === props.wall.reference) {
    emitPreview(null)
    return
  }
  emitPreview({ ...props.wall, reference })
}

/** The mirrored reference side, or null when centred (nothing to swap, spec S1a). */
const swappedReference = computed<WallReference | null>(() => {
  if (props.wall.reference === 'left') return 'right'
  if (props.wall.reference === 'right') return 'left'
  return null
})

function previewSwap(hovering: boolean): void {
  if (!hovering || swappedReference.value === null) {
    emitPreview(null)
    return
  }
  emitPreview({ ...props.wall, reference: swappedReference.value })
}

function swapSides(): void {
  if (swappedReference.value === null) return
  emitPreview(null)
  emit('update-wall', { ...props.wall, reference: swappedReference.value })
}

function toggleLock(index: number): void {
  const locked = new Set(props.wall.locked_segments)
  if (locked.has(index)) {
    locked.delete(index)
  } else {
    locked.add(index)
  }
  emit('update-wall', { ...props.wall, locked_segments: [...locked].sort((a, b) => a - b) })
}

function setAllLocks(locked: boolean): void {
  emit('update-wall', {
    ...props.wall,
    locked_segments: locked ? segments.value.map((row) => row.index) : [],
  })
}

function applySegmentLength(index: number): void {
  const draft = lengthDrafts.value[index]
  if (draft === undefined || draft.trim() === '') return
  const targetIn = parseFeetInches(draft)
  if (targetIn === null || targetIn <= 0) {
    setNotice({ kind: 'error', text: "Enter a length like 12'6 or 9'0 1/8." })
    return
  }
  const result = setSegmentLength(
    {
      vertices: props.wall.vertices,
      closed: props.wall.closed,
      lockedSegments: props.wall.locked_segments,
    },
    index,
    targetIn,
  )
  if (result.status === 'ok') {
    lengthDrafts.value = { ...lengthDrafts.value, [index]: '' }
    setNotice(null)
    emit('update-wall', { ...props.wall, vertices: result.vertices })
    return
  }
  if (result.status === 'blocked') {
    const list = result.blockingSegments.map((segment) => segment + 1).join(', ')
    setNotice({
      kind: 'error',
      text:
        result.blockingSegments.length > 0
          ? `Blocked by locked segment${result.blockingSegments.length > 1 ? 's' : ''} ${list}.`
          : 'This edit cannot be applied.',
    })
    emit('flash-segments', result.blockingSegments)
    return
  }
  setNotice({
    kind: 'info',
    text: `Loop closes with ${formatFeetInches(result.misclosureIn, precisionIn.value)} left over on this wall — geometry left unchanged.`,
  })
  if (result.blockingSegments.length > 0) emit('flash-segments', result.blockingSegments)
}

watch(
  () => props.wall.id,
  () => {
    lengthDrafts.value = {}
    setNotice(null)
    customThicknessText.value = ''
    customThicknessError.value = false
  },
)

// Any wall replacement (edit, undo, redo) invalidates a hover preview built
// from the previous wall object.
watch(
  () => props.wall,
  () => emitPreview(null),
)

onBeforeUnmount(() => emitPreview(null))
</script>

<template>
  <section aria-label="Wall inspector" class="flex flex-col gap-4 text-xs">
    <header class="flex items-center justify-between">
      <div>
        <h3 class="text-ink text-sm font-semibold">Wall</h3>
        <p class="text-ink-muted tabular-nums">
          {{ segments.length }} segment{{ segments.length === 1 ? '' : 's' }} ·
          {{ totalLengthLabel }}
        </p>
      </div>
      <span
        v-if="wall.closed"
        class="bg-accent-soft text-accent rounded-full px-2 py-0.5 font-medium"
      >
        closed
      </span>
    </header>

    <div>
      <h4 class="text-ink mb-2 font-semibold">Thickness</h4>
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Thickness presets">
        <button
          v-for="preset in thicknessPresetsIn"
          :key="preset"
          type="button"
          :aria-pressed="isThicknessSelected(preset)"
          class="rounded-md border px-2 py-1 transition-colors"
          :class="
            isThicknessSelected(preset)
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-line text-ink-muted hover:text-ink'
          "
          @click="setThickness(preset)"
        >
          {{ inchesLabel(preset) }}
        </button>
      </div>
      <label class="mt-2 block">
        <span class="text-ink-muted">Custom</span>
        <input
          v-model="customThicknessText"
          type="text"
          :placeholder="inchesLabel(wall.thickness_in)"
          class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 outline-none"
          :class="customThicknessError ? 'border-danger' : ''"
          :aria-invalid="customThicknessError"
          aria-label="Custom thickness in feet and inches"
          @keydown.enter.prevent="applyCustomThickness"
          @blur="applyCustomThickness"
        />
      </label>
    </div>

    <div>
      <h4 class="text-ink mb-2 font-semibold">Colour</h4>
      <WallColorControl
        :color="wall.color"
        :default-color="roleDefaultColor"
        :default-label="role"
        @set-color="setColor"
      />
    </div>

    <div>
      <h4 class="text-ink mb-2 font-semibold">Reference side</h4>
      <WallReferenceControl
        :reference="wall.reference"
        @set-reference="setReference"
        @preview-reference="previewReference"
      />
      <button
        type="button"
        class="border-line text-ink-muted hover:text-ink mt-2 flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="swappedReference === null"
        :title="
          swappedReference === null
            ? 'A centred reference has nothing to swap'
            : 'Mirror the thickness to the other side of the reference line'
        "
        @mouseenter="previewSwap(true)"
        @mouseleave="previewSwap(false)"
        @click="swapSides"
      >
        <ArrowLeftRight :size="13" aria-hidden="true" />
        Swap sides
      </button>
    </div>

    <div>
      <div class="mb-2 flex items-center justify-between">
        <h4 class="text-ink font-semibold">Segments</h4>
        <button
          type="button"
          class="text-ink-muted hover:text-ink underline-offset-2 hover:underline"
          @click="setAllLocks(!allLocked)"
        >
          {{ allLocked ? 'Unlock all' : 'Lock all' }}
        </button>
      </div>

      <p
        v-if="notice"
        role="alert"
        class="mb-2 rounded-md px-2 py-1.5 leading-snug"
        :class="
          notice.kind === 'error' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'
        "
      >
        {{ notice.text }}
      </p>

      <ul class="flex flex-col gap-1" aria-label="Wall segments">
        <li
          v-for="row in segments"
          :key="row.index"
          class="border-line flex items-center gap-2 rounded-md border px-2 py-1"
        >
          <span class="text-ink-faint w-4 tabular-nums">{{ row.index + 1 }}</span>
          <span class="text-ink w-16 tabular-nums">{{ row.label }}</span>
          <input
            v-model="lengthDrafts[row.index]"
            type="text"
            :placeholder="row.label"
            :disabled="row.locked"
            class="border-line focus:border-accent min-w-0 flex-1 rounded border px-1.5 py-0.5 outline-none disabled:opacity-50"
            :aria-label="`Exact length of segment ${row.index + 1}`"
            @keydown.enter.prevent="applySegmentLength(row.index)"
          />
          <button
            type="button"
            :aria-pressed="row.locked"
            :aria-label="`${row.locked ? 'Unlock' : 'Lock'} segment ${row.index + 1}`"
            class="rounded p-1 transition-colors"
            :class="row.locked ? 'text-accent' : 'text-ink-faint hover:text-ink'"
            @click="toggleLock(row.index)"
          >
            <Lock v-if="row.locked" :size="13" aria-hidden="true" />
            <LockOpen v-else :size="13" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </div>

    <button
      type="button"
      class="border-danger/40 text-danger hover:bg-danger-soft flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
      @click="emit('delete-wall')"
    >
      <Trash2 :size="13" aria-hidden="true" />
      Delete wall
    </button>
  </section>
</template>
