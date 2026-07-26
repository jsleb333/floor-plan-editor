<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import DeviceGlyph from '@/components/editor/DeviceGlyph.vue'
import type { DeviceDraft } from '@/composables/useDeviceTool'
import { useDisplayPrecision } from '@/composables/useDisplayPrecision'
import {
  BASEBOARD_WATTAGE_PRESETS,
  DEVICE_CATALOG,
  deviceFootprint,
  effectiveDefaultLoad,
} from '@/devices/catalog'
import type { DeviceFootprint } from '@/devices/catalog'
import type { DeviceType } from '@/types/plan'
import { formatFeetInches, parseFeetInches } from '@/utils/units'

const props = defineProps<{
  /** The armed device type; the draft below applies to its next placement. */
  type: DeviceType
  draft: DeviceDraft
  /** Plan-level per-type default loads (spec §5.9 tier 2). */
  catalogDefaults: Record<string, number>
}>()

const emit = defineEmits<{
  /** A field of the armed type's draft changed; the page persists it (spec E8). */
  'update-draft': [patch: Partial<DeviceDraft>]
  /** Returns to the device picker — the same effect as Esc (spec §6.1). */
  'change-device': []
}>()

const precisionIn = useDisplayPrecision()

const labelText = ref('')
const lengthText = ref('')
const depthText = ref('')
// Vue casts a `v-model` bound to `type="number"` to a number as soon as the
// text parses, so this holds either; the type keeps callers honest.
const loadText = ref<string | number>('')

const entry = computed(() => DEVICE_CATALOG[props.type])
const isBaseboard = computed(() => props.type === 'baseboard_heater')

const defaultLoad = computed(() => effectiveDefaultLoad(props.type, props.catalogDefaults))

const loadPlaceholder = computed(() => {
  const info = defaultLoad.value
  const prefix = info.source === 'plan' ? 'plan default' : 'default'
  return `${prefix} ${info.value} W`
})

/** The size the next placement gets: the draft's overrides over the catalog footprint (spec D2). */
const effectiveFootprint = computed<DeviceFootprint | null>(() => {
  const base = deviceFootprint(props.type)
  if (!base) return null
  return {
    along_in: props.draft.length_in ?? base.along_in,
    across_in: props.draft.depth_in ?? base.across_in,
  }
})

function applyLabel(): void {
  const text = labelText.value.trim()
  emit('update-draft', { label: text === '' ? null : labelText.value })
}

function applyLoad(): void {
  const text = String(loadText.value).trim()
  if (text === '') {
    emit('update-draft', { load_w: null })
    return
  }
  const parsed = Number.parseFloat(text)
  if (Number.isFinite(parsed) && parsed >= 0) emit('update-draft', { load_w: parsed })
}

function applyLength(): void {
  const parsed = parseFeetInches(lengthText.value)
  if (parsed !== null && parsed > 0) {
    emit('update-draft', { length_in: parsed })
    lengthText.value = ''
  }
}

function applyDepth(): void {
  const parsed = parseFeetInches(depthText.value)
  if (parsed !== null && parsed > 0) {
    emit('update-draft', { depth_in: parsed })
    depthText.value = ''
  }
}

function setWattage(watts: number): void {
  emit('update-draft', { load_w: watts })
}

watch(
  () => props.draft,
  (draft) => {
    labelText.value = draft.label ?? ''
    loadText.value = draft.load_w === null ? '' : String(draft.load_w)
    lengthText.value = ''
    depthText.value = ''
  },
  { immediate: true },
)
</script>

<template>
  <section aria-label="Device tool options" class="flex flex-col gap-4">
    <header class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="text-ink"><DeviceGlyph :type="type" :size="28" /></span>
        <h3 class="text-ink text-sm font-semibold">{{ entry.label }}</h3>
      </div>
      <button
        type="button"
        class="border-line text-ink-muted hover:border-accent hover:text-ink rounded-md border px-2 py-1 text-xs transition-colors"
        @click="emit('change-device')"
      >
        Change device
      </button>
    </header>

    <label class="block">
      <span class="text-ink-muted text-xs">Label</span>
      <input
        v-model="labelText"
        type="text"
        placeholder="Optional label"
        class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 text-xs outline-none"
        aria-label="Device label"
        @keydown.enter.prevent="applyLabel"
        @blur="applyLabel"
      />
    </label>

    <label class="block">
      <span class="text-ink-muted text-xs">Load override</span>
      <div class="mt-1 flex items-center gap-2">
        <input
          v-model="loadText"
          type="number"
          min="0"
          :placeholder="loadPlaceholder"
          class="border-line focus:border-accent w-full rounded-md border px-2 py-1 text-xs outline-none"
          aria-label="Load override in watts"
          @keydown.enter.prevent="applyLoad"
          @blur="applyLoad"
        />
        <span class="text-ink-faint text-xs">W</span>
      </div>
      <p class="text-ink-faint mt-1 text-xs">Leave blank to use the {{ loadPlaceholder }}.</p>
    </label>

    <div v-if="effectiveFootprint" aria-label="Device dimensions">
      <h4 class="text-ink mb-2 text-xs font-semibold">Dimensions</h4>
      <div class="flex items-start gap-2">
        <label class="block flex-1">
          <span class="text-ink-muted text-xs">Length</span>
          <input
            v-model="lengthText"
            type="text"
            :placeholder="formatFeetInches(effectiveFootprint.along_in, precisionIn)"
            class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 text-xs outline-none"
            aria-label="Device length in feet and inches"
            @keydown.enter.prevent="applyLength"
            @blur="applyLength"
          />
        </label>
        <label class="block flex-1">
          <span class="text-ink-muted text-xs">Depth</span>
          <input
            v-model="depthText"
            type="text"
            :placeholder="formatFeetInches(effectiveFootprint.across_in, precisionIn)"
            class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 text-xs outline-none"
            aria-label="Device depth in feet and inches"
            @keydown.enter.prevent="applyDepth"
            @blur="applyDepth"
          />
        </label>
      </div>
    </div>

    <div v-if="isBaseboard" aria-label="Baseboard properties">
      <h4 class="text-ink mb-2 text-xs font-semibold">Baseboard</h4>
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Wattage presets">
        <button
          v-for="watts in BASEBOARD_WATTAGE_PRESETS"
          :key="watts"
          type="button"
          :aria-pressed="draft.load_w === watts"
          class="rounded-md border px-2 py-1 text-xs transition-colors"
          :class="
            draft.load_w === watts
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-line text-ink-muted hover:text-ink'
          "
          @click="setWattage(watts)"
        >
          {{ watts }} W
        </button>
      </div>
    </div>
  </section>
</template>
