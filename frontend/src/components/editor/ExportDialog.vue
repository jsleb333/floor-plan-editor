<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { Circuit, PlanDocument } from '@/types/plan'
import { downloadBlob } from '@/export/download'
import { exportPlanJson } from '@/export/jsonExport'
import { PIXELS_PER_FOOT_PRESETS, renderPlanPng } from '@/export/pngExport'
import { buildPlanSvg, embedUnderlay, slugify } from '@/export/svgExport'
import type { SvgExportOptions, UnderlayEmbed } from '@/export/svgExport'

type ExportFormat = 'svg' | 'png' | 'json'

const props = defineProps<{
  planName: string
  document: PlanDocument
  circuits: readonly Circuit[]
  /** Natural pixel size of the underlay image, or null when there is none/unloaded. */
  underlayImageSize: { width: number; height: number } | null
  /** Circuit ids visible on the canvas — the default export selection (spec X4). */
  visibleCircuitIds: readonly string[]
}>()

const emit = defineEmits<{
  close: []
}>()

const EXTENSIONS: Record<ExportFormat, string> = { svg: '.svg', png: '.png', json: '.json' }
const FORMATS: readonly ExportFormat[] = ['svg', 'png', 'json']

const format = ref<ExportFormat>('svg')
const includeUnderlay = ref(false)
const includeAnnotations = ref(true)
const includeGuides = ref(false)
const pixelsPerFoot = ref(24)
const transparentBackground = ref(false)
const selectedCircuitIds = ref<Set<string>>(new Set(props.visibleCircuitIds))
const filenameBase = ref(slugify(props.planName))
const busy = ref(false)
const error = ref<string | null>(null)

const hasUnderlay = computed(
  () => props.document.underlay !== null && props.underlayImageSize !== null,
)
/** Guides are offered only when the plan has some (spec S9/X4: off by default). */
const hasGuides = computed(() => props.document.guides.length > 0)
const showRasterOptions = computed(() => format.value === 'png')
const showLayerOptions = computed(() => format.value === 'svg' || format.value === 'png')
const filename = computed(
  () => `${filenameBase.value || slugify(props.planName)}${EXTENSIONS[format.value]}`,
)

function toggleCircuit(id: string): void {
  const next = new Set(selectedCircuitIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedCircuitIds.value = next
}

function circuitIdsOption(): 'all' | string[] {
  if (selectedCircuitIds.value.size === props.circuits.length) return 'all'
  return [...selectedCircuitIds.value]
}

async function resolveUnderlay(): Promise<UnderlayEmbed | null> {
  if (!includeUnderlay.value || !props.document.underlay || !props.underlayImageSize) return null
  return embedUnderlay(props.document.underlay, props.underlayImageSize)
}

function sharedSvgOptions(underlay: UnderlayEmbed | null): SvgExportOptions {
  return {
    includeUnderlay: includeUnderlay.value && hasUnderlay.value,
    includeAnnotations: includeAnnotations.value,
    includeGuides: includeGuides.value && hasGuides.value,
    circuitIds: circuitIdsOption(),
    underlay,
  }
}

async function handleExport(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    if (format.value === 'json') {
      const blob = exportPlanJson(
        { name: props.planName, document: props.document },
        new Date().toISOString(),
      )
      downloadBlob(blob, filename.value)
    } else if (format.value === 'svg') {
      const underlay = await resolveUnderlay()
      const svg = buildPlanSvg(props.document, sharedSvgOptions(underlay))
      downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), filename.value)
    } else {
      const underlay = await resolveUnderlay()
      const blob = await renderPlanPng(props.document, {
        ...sharedSvgOptions(underlay),
        pixelsPerFoot: pixelsPerFoot.value,
        transparentBackground: transparentBackground.value,
      })
      downloadBlob(blob, filename.value)
    }
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Export failed'
  } finally {
    busy.value = false
  }
}

watch(
  () => props.planName,
  (name) => {
    filenameBase.value = slugify(name)
  },
)

watch(hasUnderlay, (has) => {
  if (!has) includeUnderlay.value = false
})

watch(hasGuides, (has) => {
  if (!has) includeGuides.value = false
})

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown, true))
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="emit('close')"
      @keydown.esc="emit('close')"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        class="bg-surface rounded-card shadow-panel flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden"
      >
        <header class="border-line flex items-center justify-between border-b px-5 py-3">
          <h2 id="export-dialog-title" class="text-sm font-semibold">Export plan</h2>
          <button
            type="button"
            class="text-ink-muted hover:bg-canvas hover:text-ink rounded p-1 transition-colors"
            aria-label="Close export dialog"
            @click="emit('close')"
          >
            <X :size="16" aria-hidden="true" />
          </button>
        </header>

        <div class="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <fieldset>
            <legend class="text-ink-muted mb-1.5 text-xs font-medium">Format</legend>
            <div class="flex gap-2" role="radiogroup" aria-label="Export format">
              <button
                v-for="fmt in FORMATS"
                :key="fmt"
                type="button"
                role="radio"
                :aria-checked="format === fmt"
                class="flex-1 rounded-md border px-3 py-1.5 text-sm font-medium uppercase transition-colors"
                :class="
                  format === fmt
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line text-ink-muted hover:text-ink'
                "
                @click="format = fmt"
              >
                {{ fmt }}
              </button>
            </div>
          </fieldset>

          <template v-if="showLayerOptions">
            <label class="flex items-center gap-2 text-sm">
              <input v-model="includeAnnotations" type="checkbox" class="accent-accent" />
              Include dimensions &amp; labels
            </label>

            <label
              class="flex items-center gap-2 text-sm"
              :class="{ 'text-ink-faint': !hasUnderlay }"
              :title="hasUnderlay ? undefined : 'This plan has no underlay image.'"
            >
              <input
                v-model="includeUnderlay"
                type="checkbox"
                class="accent-accent"
                :disabled="!hasUnderlay"
              />
              Include underlay image
            </label>

            <label
              class="flex items-center gap-2 text-sm"
              :class="{ 'text-ink-faint': !hasGuides }"
              :title="hasGuides ? undefined : 'This plan has no guides.'"
            >
              <input
                v-model="includeGuides"
                type="checkbox"
                class="accent-accent"
                :disabled="!hasGuides"
              />
              Include guides
            </label>

            <div v-if="circuits.length > 0" aria-label="Circuits to include">
              <p class="text-ink-muted mb-1.5 text-xs font-medium">Circuits</p>
              <ul class="space-y-1">
                <li v-for="circuit in circuits" :key="circuit.id">
                  <label class="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      class="accent-accent"
                      :checked="selectedCircuitIds.has(circuit.id)"
                      @change="toggleCircuit(circuit.id)"
                    />
                    <span
                      class="h-3 w-3 shrink-0 rounded"
                      :style="{ backgroundColor: circuit.color }"
                      aria-hidden="true"
                    />
                    {{ circuit.name }}
                  </label>
                </li>
              </ul>
            </div>
          </template>

          <template v-if="showRasterOptions">
            <div>
              <p class="text-ink-muted mb-1.5 text-xs font-medium">Scale (pixels per foot)</p>
              <div class="flex gap-2" role="radiogroup" aria-label="Raster scale">
                <button
                  v-for="preset in PIXELS_PER_FOOT_PRESETS"
                  :key="preset"
                  type="button"
                  role="radio"
                  :aria-checked="pixelsPerFoot === preset"
                  class="flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
                  :class="
                    pixelsPerFoot === preset
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line text-ink-muted hover:text-ink'
                  "
                  @click="pixelsPerFoot = preset"
                >
                  {{ preset }}
                </button>
              </div>
            </div>
            <label class="flex items-center gap-2 text-sm">
              <input v-model="transparentBackground" type="checkbox" class="accent-accent" />
              Transparent background
            </label>
          </template>

          <div>
            <label for="export-filename" class="text-ink-muted mb-1.5 block text-xs font-medium">
              File name
            </label>
            <div class="border-line focus-within:border-accent flex items-center rounded-md border">
              <input
                id="export-filename"
                v-model="filenameBase"
                type="text"
                class="min-w-0 flex-1 rounded-l-md px-3 py-1.5 text-sm outline-none"
              />
              <span class="text-ink-faint px-2 text-sm tabular-nums">{{ EXTENSIONS[format] }}</span>
            </div>
          </div>

          <p
            v-if="error"
            role="alert"
            class="bg-danger-soft text-danger rounded-md px-3 py-2 text-xs"
          >
            {{ error }}
          </p>
        </div>

        <footer class="border-line flex justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            class="text-ink-muted hover:text-ink rounded-md px-3 py-1.5 text-sm transition-colors"
            @click="emit('close')"
          >
            Cancel
          </button>
          <button
            type="button"
            :disabled="busy"
            class="bg-accent hover:bg-accent-strong rounded-md px-4 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
            @click="handleExport"
          >
            {{ busy ? 'Exporting…' : 'Export' }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
