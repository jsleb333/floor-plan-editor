<script setup lang="ts">
import { computed } from 'vue'

import { useDisplayPrecision } from '@/composables/useDisplayPrecision'
import type { DimensionToolPreview } from '@/composables/useDimensionTool'
import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type { Dimension, Point } from '@/types/plan'
import { dimensionLayout } from '@/utils/geometry'
import { formatFeetInches } from '@/utils/units'

const TEXT_FONT_PX = 11
const MARKER_HALF_PX = 4.5

const props = defineProps<{
  /** World-unit stroke width rendering as ~1px on screen. */
  hairline: number
  /** Pending dimension previewed by the dimension tool, if any. */
  preview?: DimensionToolPreview | null
}>()

const editorStore = useEditorStore()
const layersStore = useLayersStore()
const precisionIn = useDisplayPrecision()

interface DimensionView {
  id: string
  line: { a: Point; b: Point }
  extensions: { a: Point; b: Point }[]
  ticks: { a: Point; b: Point }[]
  textAnchor: Point
  textAngleDeg: number
  label: string
  selected: boolean
  preview: boolean
}

function buildView(
  dimension: Dimension,
  selected: boolean,
  isPreview: boolean,
): DimensionView | null {
  const layout = dimensionLayout(dimension)
  if (!layout) return null
  return {
    id: dimension.id,
    line: layout.line,
    extensions: layout.extensions,
    ticks: layout.ticks,
    textAnchor: layout.textAnchor,
    textAngleDeg: layout.textAngleDeg,
    label: formatFeetInches(layout.distanceIn, precisionIn.value),
    selected,
    preview: isPreview,
  }
}

const dimensionViews = computed<DimensionView[]>(() => {
  void editorStore.documentVersion
  const views: DimensionView[] = []
  for (const dimension of editorStore.document?.dimensions ?? []) {
    const view = buildView(
      dimension,
      editorStore.isSelected({ kind: 'dimension', id: dimension.id }),
      false,
    )
    if (view) views.push(view)
  }
  if (props.preview?.dimension) {
    const view = buildView(props.preview.dimension, false, true)
    if (view) views.push(view)
  }
  return views
})

function strokeClass(view: DimensionView): string {
  if (view.preview) return 'stroke-accent'
  return view.selected ? 'stroke-accent-strong' : 'stroke-ink-muted'
}
</script>

<template>
  <g v-if="layersStore.annotationsVisible" aria-label="Dimensions">
    <g v-for="view in dimensionViews" :key="view.id" :opacity="view.preview ? 0.85 : 1">
      <line
        v-for="(extension, index) in view.extensions"
        :key="`ext-${index}`"
        :x1="extension.a.x"
        :y1="extension.a.y"
        :x2="extension.b.x"
        :y2="extension.b.y"
        :class="strokeClass(view)"
        :stroke-width="hairline"
      />
      <line
        :x1="view.line.a.x"
        :y1="view.line.a.y"
        :x2="view.line.b.x"
        :y2="view.line.b.y"
        :class="strokeClass(view)"
        :stroke-width="(view.selected ? 1.5 : 1) * hairline"
      />
      <line
        v-for="(tick, index) in view.ticks"
        :key="`tick-${index}`"
        :x1="tick.a.x"
        :y1="tick.a.y"
        :x2="tick.b.x"
        :y2="tick.b.y"
        :class="strokeClass(view)"
        :stroke-width="1.5 * hairline"
      />
      <text
        :x="view.textAnchor.x"
        :y="view.textAnchor.y"
        :font-size="TEXT_FONT_PX * hairline"
        text-anchor="middle"
        paint-order="stroke"
        :stroke-width="3 * hairline"
        :transform="`rotate(${view.textAngleDeg} ${view.textAnchor.x} ${view.textAnchor.y})`"
        class="stroke-canvas select-none"
        :class="view.selected ? 'fill-accent-strong' : 'fill-ink'"
      >
        {{ view.label }}
      </text>
    </g>

    <g v-if="preview">
      <circle
        v-if="preview.start"
        :cx="preview.start.x"
        :cy="preview.start.y"
        :r="2.5 * hairline"
        class="fill-accent-strong"
      />
      <line
        v-if="preview.start && preview.point"
        :x1="preview.start.x"
        :y1="preview.start.y"
        :x2="preview.point.x"
        :y2="preview.point.y"
        class="stroke-accent-strong"
        :stroke-width="hairline"
        :stroke-dasharray="`${4 * hairline} ${4 * hairline}`"
      />
      <circle
        v-if="preview.marker"
        :cx="preview.marker.point.x"
        :cy="preview.marker.point.y"
        :r="MARKER_HALF_PX * hairline"
        class="fill-surface stroke-accent-strong"
        :stroke-width="1.5 * hairline"
      />
      <circle
        v-else-if="preview.point"
        :cx="preview.point.x"
        :cy="preview.point.y"
        :r="2 * hairline"
        class="fill-accent-strong"
      />
    </g>
  </g>
</template>
