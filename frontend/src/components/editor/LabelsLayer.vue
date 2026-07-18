<script setup lang="ts">
import { computed } from 'vue'

import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import { labelBounds, labelFontSizeIn } from '@/utils/geometry'
import type { Bounds } from '@/utils/geometry'

defineProps<{
  /** World-unit stroke width rendering as ~1px on screen. */
  hairline: number
}>()

const editorStore = useEditorStore()
const layersStore = useLayersStore()

interface LabelView {
  id: string
  x: number
  y: number
  fontSizeIn: number
  text: string
  selected: boolean
  bounds: Bounds
}

const labelViews = computed<LabelView[]>(() => {
  void editorStore.documentVersion
  return (editorStore.document?.labels ?? []).map((label) => ({
    id: label.id,
    x: label.position.x,
    y: label.position.y,
    fontSizeIn: labelFontSizeIn(label.size_in),
    text: label.text,
    selected: editorStore.isSelected({ kind: 'label', id: label.id }),
    bounds: labelBounds(label),
  }))
})
</script>

<template>
  <g v-if="layersStore.annotationsVisible" aria-label="Labels">
    <g v-for="view in labelViews" :key="view.id">
      <rect
        v-if="view.selected"
        :x="view.bounds.minX"
        :y="view.bounds.minY"
        :width="view.bounds.maxX - view.bounds.minX"
        :height="view.bounds.maxY - view.bounds.minY"
        class="fill-accent/10 stroke-accent"
        :stroke-width="hairline"
        :stroke-dasharray="`${3 * hairline} ${3 * hairline}`"
      />
      <text
        :x="view.x"
        :y="view.y"
        :font-size="view.fontSizeIn"
        :class="view.selected ? 'fill-accent-strong' : 'fill-ink'"
        class="select-none"
      >
        {{ view.text }}
      </text>
    </g>
  </g>
</template>
