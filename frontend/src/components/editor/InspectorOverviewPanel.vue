<script setup lang="ts">
import { Download, Eye, EyeOff } from 'lucide-vue-next'
import { computed } from 'vue'

import PlanSettingsPanel from '@/components/editor/PlanSettingsPanel.vue'
import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type { Underlay } from '@/types/plan'

/** The whole-plan layer rows, in drawing order (spec E7). */
const LAYER_ROWS: readonly {
  key: 'structureVisible' | 'devicesVisible' | 'annotationsVisible'
  label: string
  noun: string
}[] = [
  { key: 'structureVisible', label: 'Structure', noun: 'structure' },
  { key: 'devicesVisible', label: 'Devices', noun: 'devices' },
  { key: 'annotationsVisible', label: 'Annotations', noun: 'annotations' },
]

defineProps<{
  planName: string
  planDescription: string
  /** The document's precision override; `null` means the 1/8" default (spec §5.9 tier 2). */
  displayPrecisionIn: number | null
}>()

const emit = defineEmits<{
  rename: [name: string]
  'update-description': [description: string]
  'set-display-precision': [precisionIn: number]
  /** Opens the export options dialog (spec X4). */
  export: []
}>()

const editorStore = useEditorStore()
const layersStore = useLayersStore()

/** The underlay row only exists once the plan carries an underlay (spec E7/U3). */
const underlay = computed<Underlay | null>(() => {
  void editorStore.documentVersion
  return editorStore.document?.underlay ?? null
})

function toggleUnderlay(): void {
  if (!underlay.value) return
  editorStore.mutate({
    type: 'setUnderlay',
    underlay: { ...underlay.value, visible: !underlay.value.visible },
  })
}
</script>

<template>
  <section aria-label="Inspector overview" class="flex flex-col gap-4 text-xs">
    <PlanSettingsPanel
      :plan-name="planName"
      :plan-description="planDescription"
      :display-precision-in="displayPrecisionIn"
      @rename="emit('rename', $event)"
      @update-description="emit('update-description', $event)"
      @set-display-precision="emit('set-display-precision', $event)"
    />

    <section aria-label="Layers" class="border-line flex flex-col gap-2 border-t pt-4">
      <h3 class="text-ink text-sm font-semibold">Layers</h3>

      <div v-if="underlay" class="flex items-center gap-1.5">
        <span class="text-ink flex-1">Underlay</span>
        <button
          type="button"
          :aria-pressed="underlay.visible"
          :aria-label="underlay.visible ? 'Hide underlay' : 'Show underlay'"
          class="hover:bg-canvas rounded p-1 transition-colors"
          :class="underlay.visible ? 'text-ink' : 'text-ink-faint'"
          @click="toggleUnderlay"
        >
          <component :is="underlay.visible ? Eye : EyeOff" :size="14" aria-hidden="true" />
        </button>
      </div>

      <div v-for="row in LAYER_ROWS" :key="row.key" class="flex items-center gap-1.5">
        <span class="text-ink flex-1">{{ row.label }}</span>
        <button
          type="button"
          :aria-pressed="layersStore[row.key]"
          :aria-label="`${layersStore[row.key] ? 'Hide' : 'Show'} ${row.noun}`"
          class="hover:bg-canvas rounded p-1 transition-colors"
          :class="layersStore[row.key] ? 'text-ink' : 'text-ink-faint'"
          @click="layersStore[row.key] = !layersStore[row.key]"
        >
          <component :is="layersStore[row.key] ? Eye : EyeOff" :size="14" aria-hidden="true" />
        </button>
      </div>

      <p class="text-ink-muted leading-relaxed">
        Per-circuit wire and device visibility lives on each circuit's row, in Electrical mode.
      </p>
    </section>

    <button
      type="button"
      class="border-line text-ink-muted hover:text-ink hover:bg-canvas flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
      aria-label="Export plan"
      @click="emit('export')"
    >
      <Download :size="13" aria-hidden="true" />
      Export
    </button>
  </section>
</template>
