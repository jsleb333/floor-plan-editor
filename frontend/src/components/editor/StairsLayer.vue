<script setup lang="ts">
import { computed } from 'vue'

import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type { Point, Stairs } from '@/types/plan'
import {
  arrowHeadStrokes,
  stairsArrow,
  stairsCenter,
  stairsCorners,
  stairsTreads,
} from '@/utils/geometry'

const ARROW_HEAD_IN = 6
const LABEL_FONT_PX = 11

const props = defineProps<{
  /** World-unit stroke width rendering as ~1px on screen. */
  hairline: number
  /** Transient run previewed by the stairs tool, if any. */
  preview?: Stairs | null
}>()

const editorStore = useEditorStore()
const layersStore = useLayersStore()

interface StairsView {
  id: string
  outline: string
  treads: { a: Point; b: Point }[]
  arrow: { tail: Point; head: Point }
  arrowHead: { a: Point; b: Point }[]
  labelAt: Point
  label: string
  selected: boolean
  preview: boolean
}

function buildView(stairs: Stairs, selected: boolean, isPreview: boolean): StairsView | null {
  if (stairs.length_in <= 0 || stairs.width_in <= 0) return null
  const arrow = stairsArrow(stairs)
  return {
    id: stairs.id,
    outline: stairsCorners(stairs)
      .map((p) => `${p.x},${p.y}`)
      .join(' '),
    treads: stairsTreads(stairs),
    arrow,
    arrowHead: arrowHeadStrokes(arrow.tail, arrow.head, ARROW_HEAD_IN),
    labelAt: stairsCenter(stairs),
    label: stairs.direction,
    selected,
    preview: isPreview,
  }
}

const stairsViews = computed<StairsView[]>(() => {
  void editorStore.documentVersion
  const views: StairsView[] = []
  for (const stairs of editorStore.document?.stairs ?? []) {
    const view = buildView(stairs, editorStore.isSelected({ kind: 'stairs', id: stairs.id }), false)
    if (view) views.push(view)
  }
  if (props.preview) {
    const view = buildView(props.preview, false, true)
    if (view) views.push(view)
  }
  return views
})

function strokeClass(view: StairsView): string {
  if (view.preview) return 'stroke-accent'
  return view.selected ? 'stroke-accent-strong' : 'stroke-ink-muted'
}
</script>

<template>
  <g v-if="layersStore.structureVisible" aria-label="Stairs">
    <g v-for="view in stairsViews" :key="view.id" :opacity="view.preview ? 0.75 : 1">
      <polygon
        :points="view.outline"
        :class="[
          strokeClass(view),
          view.selected || view.preview ? 'fill-accent/10' : 'fill-transparent',
        ]"
        :stroke-width="(view.selected ? 1.5 : 1) * hairline"
      />
      <line
        v-for="(tread, index) in view.treads"
        :key="`tread-${index}`"
        :x1="tread.a.x"
        :y1="tread.a.y"
        :x2="tread.b.x"
        :y2="tread.b.y"
        :class="strokeClass(view)"
        :stroke-width="hairline"
      />
      <line
        :x1="view.arrow.tail.x"
        :y1="view.arrow.tail.y"
        :x2="view.arrow.head.x"
        :y2="view.arrow.head.y"
        :class="strokeClass(view)"
        :stroke-width="1.5 * hairline"
      />
      <line
        v-for="(stroke, index) in view.arrowHead"
        :key="`head-${index}`"
        :x1="stroke.a.x"
        :y1="stroke.a.y"
        :x2="stroke.b.x"
        :y2="stroke.b.y"
        :class="strokeClass(view)"
        :stroke-width="1.5 * hairline"
      />
      <text
        :x="view.labelAt.x"
        :y="view.labelAt.y"
        :font-size="LABEL_FONT_PX * hairline"
        text-anchor="middle"
        paint-order="stroke"
        :stroke-width="3 * hairline"
        class="stroke-canvas fill-ink-muted select-none"
      >
        {{ view.label }}
      </text>
    </g>
  </g>
</template>
