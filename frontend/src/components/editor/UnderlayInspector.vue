<script setup lang="ts">
import { Crosshair, Eye, EyeOff, Lock, LockOpen, Trash2 } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'

import type { Underlay } from '@/types/plan'
import type { ImageSize } from '@/utils/imageSize'
import { rotatedAboutCenter } from '@/utils/underlay'
import { formatFeetInches } from '@/utils/units'

const props = defineProps<{
  underlay: Underlay
  /** Natural pixel size of the image; rotation is applied about its centre when known. */
  imageSize: ImageSize | null
}>()

const emit = defineEmits<{
  /** Whole-underlay replacement — the page dispatches ONE setUnderlay (one undo step). */
  'update-underlay': [underlay: Underlay]
  recalibrate: []
  'remove-underlay': []
}>()

const rotationDraft = ref('')
const rotationError = ref(false)

const opacityPercent = computed(() => Math.round(props.underlay.opacity * 100))

function update(patch: Partial<Underlay>): void {
  emit('update-underlay', { ...props.underlay, ...patch })
}

function applyOpacity(event: Event): void {
  if (!(event.target instanceof HTMLInputElement)) return
  update({ opacity: Number.parseInt(event.target.value, 10) / 100 })
}

/** Wraps any angle into (-180, 180]. */
function normalizeDegrees(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360
  return wrapped > 180 ? wrapped - 360 : wrapped
}

function applyRotation(): void {
  if (rotationDraft.value.trim() === '') {
    rotationError.value = false
    return
  }
  const parsed = Number.parseFloat(rotationDraft.value)
  if (!Number.isFinite(parsed)) {
    rotationError.value = true
    return
  }
  rotationError.value = false
  rotationDraft.value = ''
  const degrees = normalizeDegrees(parsed)
  // Rotate about the image CENTRE so the picture pivots in place (spec U3);
  // without the natural size the origin is the only anchor available.
  const transform = props.imageSize
    ? rotatedAboutCenter(props.underlay.transform, props.imageSize, degrees)
    : { ...props.underlay.transform, rotation_deg: degrees }
  update({ transform })
}

watch(
  () => props.underlay.image_ref,
  () => {
    rotationDraft.value = ''
    rotationError.value = false
  },
)
</script>

<template>
  <section aria-label="Underlay inspector" class="flex flex-col gap-4 text-xs">
    <header>
      <h3 class="text-ink text-sm font-semibold">Underlay</h3>
      <p class="text-ink-muted tabular-nums">
        origin {{ formatFeetInches(underlay.transform.origin.x) }},
        {{ formatFeetInches(underlay.transform.origin.y) }}
      </p>
      <p class="text-ink-muted tabular-nums">1 px = {{ underlay.transform.scale.toFixed(3) }}"</p>
    </header>

    <p
      v-if="rotationError"
      role="alert"
      class="bg-danger-soft text-danger rounded-md px-2 py-1.5 leading-snug"
    >
      Enter the rotation in degrees, between -180 and 180.
    </p>

    <label class="block">
      <span class="text-ink font-semibold">Rotation</span>
      <input
        v-model="rotationDraft"
        type="text"
        :placeholder="`${underlay.transform.rotation_deg}°`"
        class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 outline-none"
        aria-label="Underlay rotation in degrees"
        @keydown.enter.prevent="applyRotation"
        @blur="applyRotation"
      />
    </label>

    <label class="block">
      <span class="text-ink font-semibold">Opacity</span>
      <span class="text-ink-muted ml-1 tabular-nums">{{ opacityPercent }}%</span>
      <input
        type="range"
        min="0"
        max="100"
        :value="opacityPercent"
        class="accent-accent mt-1 w-full"
        aria-label="Underlay opacity"
        @input="applyOpacity"
      />
    </label>

    <div class="flex gap-2">
      <button
        type="button"
        :aria-pressed="underlay.visible"
        class="border-line hover:bg-canvas flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
        :class="underlay.visible ? 'text-ink' : 'text-ink-faint'"
        @click="update({ visible: !underlay.visible })"
      >
        <component :is="underlay.visible ? Eye : EyeOff" :size="13" aria-hidden="true" />
        {{ underlay.visible ? 'Visible' : 'Hidden' }}
      </button>
      <button
        type="button"
        :aria-pressed="underlay.locked"
        class="border-line hover:bg-canvas flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
        :class="underlay.locked ? 'text-accent' : 'text-ink-muted'"
        @click="update({ locked: !underlay.locked })"
      >
        <component :is="underlay.locked ? Lock : LockOpen" :size="13" aria-hidden="true" />
        {{ underlay.locked ? 'Locked' : 'Unlocked' }}
      </button>
    </div>

    <button
      type="button"
      class="border-line text-ink-muted hover:text-ink hover:bg-canvas flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
      @click="emit('recalibrate')"
    >
      <Crosshair :size="13" aria-hidden="true" />
      Recalibrate scale
    </button>

    <button
      type="button"
      class="border-danger/40 text-danger hover:bg-danger-soft flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
      @click="emit('remove-underlay')"
    >
      <Trash2 :size="13" aria-hidden="true" />
      Remove underlay
    </button>
  </section>
</template>
