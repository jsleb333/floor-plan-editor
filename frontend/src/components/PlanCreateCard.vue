<script setup lang="ts">
import { ChevronRight, ImagePlus, X } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { uploadAsset } from '@/persistence/assets'
import type { PlanCreateOptions } from '@/persistence/plans'
import DisplayPrecisionSelect from '@/components/DisplayPrecisionSelect.vue'
import ThicknessPresetsEditor from '@/components/ThicknessPresetsEditor.vue'
import { usePlansStore } from '@/stores/plans'
import type { Plan } from '@/types/plan'
import { DEFAULT_DISPLAY_PRECISION_IN } from '@/utils/units'

/** The standard wall presets seeding the Defaults expander (spec §5.9 tier 2). */
const DEFAULT_THICKNESS_PRESETS_IN: readonly number[] = [12, 4.5, 3.5]
/** Underlay photo types accepted by the drop zone (spec U1). */
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png']

const emit = defineEmits<{
  created: [plan: Plan]
  cancel: []
}>()

const plansStore = usePlansStore()

const name = ref('')
const description = ref('')
const photo = ref<File | null>(null)
const photoPreviewUrl = ref<string | null>(null)
const dragOver = ref(false)
const defaultsOpen = ref(false)
const presetsIn = ref<number[]>([...DEFAULT_THICKNESS_PRESETS_IN])
const precisionIn = ref(DEFAULT_DISPLAY_PRECISION_IN)
const busy = ref(false)
const error = ref<string | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const photoInput = ref<HTMLInputElement | null>(null)

const canSubmit = computed(() => name.value.trim() !== '' && !busy.value)

const presetsChanged = computed(
  () =>
    presetsIn.value.length !== DEFAULT_THICKNESS_PRESETS_IN.length ||
    presetsIn.value.some((preset, index) => preset !== DEFAULT_THICKNESS_PRESETS_IN[index]),
)

function revokePreview(): void {
  if (photoPreviewUrl.value) URL.revokeObjectURL(photoPreviewUrl.value)
  photoPreviewUrl.value = null
}

function acceptPhoto(file: File): void {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    error.value = 'Only JPEG and PNG images are supported.'
    return
  }
  error.value = null
  revokePreview()
  photo.value = file
  photoPreviewUrl.value = URL.createObjectURL(file)
}

function handleDrop(event: DragEvent): void {
  dragOver.value = false
  const file = event.dataTransfer?.files[0]
  if (file) acceptPhoto(file)
}

function handleBrowse(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) acceptPhoto(file)
}

function removePhoto(): void {
  photo.value = null
  revokePreview()
}

/**
 * The creation payload, holding only the fields the user actually set (spec
 * P5): untouched defaults are omitted so the backend seeds its own.
 */
function buildOptions(underlayAssetId: string | undefined): PlanCreateOptions {
  const options: PlanCreateOptions = {}
  const trimmedDescription = description.value.trim()
  if (trimmedDescription) options.description = trimmedDescription
  if (underlayAssetId) options.underlay_asset_id = underlayAssetId
  if (presetsChanged.value) options.thickness_presets_in = [...presetsIn.value]
  if (precisionIn.value !== DEFAULT_DISPLAY_PRECISION_IN) {
    options.display_precision_in = precisionIn.value
  }
  return options
}

async function handleSubmit(): Promise<void> {
  const trimmedName = name.value.trim()
  if (!trimmedName || busy.value) return
  busy.value = true
  error.value = null
  try {
    // The photo is uploaded on submit — not on drop — so an abandoned card
    // leaves no orphaned asset behind (spec P5).
    let underlayAssetId: string | undefined
    if (photo.value) {
      const asset = await uploadAsset(photo.value)
      underlayAssetId = asset.id
    }
    const plan = await plansStore.create(trimmedName, buildOptions(underlayAssetId))
    emit('created', plan)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unexpected error'
  } finally {
    busy.value = false
  }
}

onMounted(() => nameInput.value?.focus())

onBeforeUnmount(revokePreview)
</script>

<template>
  <form
    aria-label="Create plan"
    class="border-line bg-surface rounded-card shadow-card mb-6 flex flex-col gap-3 border p-4"
    @submit.prevent="handleSubmit"
  >
    <input
      ref="nameInput"
      v-model="name"
      type="text"
      placeholder="Plan name (e.g. Basement)"
      aria-label="New plan name"
      class="border-line focus:border-accent rounded-md border px-3 py-1.5 text-sm outline-none"
      @keydown.esc="emit('cancel')"
    />
    <input
      v-model="description"
      type="text"
      placeholder="Description (optional)"
      aria-label="New plan description"
      class="border-line focus:border-accent rounded-md border px-3 py-1.5 text-sm outline-none"
      @keydown.esc="emit('cancel')"
    />

    <input
      ref="photoInput"
      type="file"
      accept="image/jpeg,image/png"
      class="hidden"
      aria-hidden="true"
      @change="handleBrowse"
    />
    <button
      v-if="!photo"
      type="button"
      aria-label="Add an underlay photo"
      class="rounded-md border border-dashed px-3 py-5 text-sm transition-colors"
      :class="
        dragOver
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line text-ink-muted hover:border-ink-faint hover:text-ink'
      "
      @click="photoInput?.click()"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="handleDrop"
    >
      <span class="pointer-events-none flex items-center justify-center gap-2">
        <ImagePlus :size="16" aria-hidden="true" />
        Drop a floor-plan photo to trace (JPEG/PNG), or click to browse
      </span>
    </button>
    <div v-else class="border-line flex items-center gap-3 rounded-md border px-3 py-2">
      <img
        v-if="photoPreviewUrl"
        :src="photoPreviewUrl"
        alt=""
        class="bg-canvas h-12 w-12 shrink-0 rounded object-cover"
      />
      <span class="text-ink min-w-0 flex-1 truncate text-sm">{{ photo.name }}</span>
      <button
        type="button"
        class="text-ink-muted hover:bg-danger-soft hover:text-danger rounded p-1.5 transition-colors"
        aria-label="Remove photo"
        @click="removePhoto"
      >
        <X :size="14" aria-hidden="true" />
      </button>
    </div>

    <section aria-label="Defaults" class="border-line rounded-md border">
      <button
        type="button"
        class="text-ink-muted hover:text-ink flex w-full items-center gap-1 px-3 py-2 text-sm font-medium transition-colors"
        :aria-expanded="defaultsOpen"
        @click="defaultsOpen = !defaultsOpen"
      >
        <ChevronRight
          :size="14"
          class="transition-transform"
          :class="defaultsOpen ? 'rotate-90' : ''"
          aria-hidden="true"
        />
        Defaults
      </button>
      <div v-if="defaultsOpen" class="flex flex-col gap-3 px-3 pb-3 text-xs">
        <div>
          <span class="text-ink font-semibold">Wall thickness presets</span>
          <p class="text-ink-muted mt-0.5 mb-1">
            Exterior first; the last is the interior default.
          </p>
          <ThicknessPresetsEditor :presets-in="presetsIn" @change="presetsIn = $event" />
        </div>
        <label class="block">
          <span class="text-ink font-semibold">Display precision</span>
          <p class="text-ink-muted mt-0.5 mb-1">Lengths shown rounded to the nearest step.</p>
          <DisplayPrecisionSelect v-model="precisionIn" />
        </label>
      </div>
    </section>

    <p v-if="error" role="alert" class="bg-danger-soft text-danger rounded-md px-3 py-2 text-sm">
      {{ error }}
    </p>

    <div class="flex items-center justify-end gap-2">
      <button
        type="button"
        class="text-ink-muted hover:text-ink rounded-md px-3 py-1.5 text-sm transition-colors"
        @click="emit('cancel')"
      >
        Cancel
      </button>
      <button
        type="submit"
        :disabled="!canSubmit"
        class="bg-accent hover:bg-accent-strong rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
      >
        {{ busy ? 'Creating…' : 'Create' }}
      </button>
    </div>
  </form>
</template>
