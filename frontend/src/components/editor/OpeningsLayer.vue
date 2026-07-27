<script setup lang="ts">
import { computed } from 'vue'

import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type { Opening, Point, Wall } from '@/types/plan'
import { DOOR_DASH_IN, doorFigure, openingWorldRect, windowSymbol } from '@/utils/geometry'
import { doorStrokeToPath } from '@/utils/svgPath'
import { wallColor } from '@/utils/wallColors'

const props = defineProps<{
  /** World-unit stroke width rendering as ~1px on screen. */
  hairline: number
  /** Transient opening previewed by the door/window tool, if any. */
  preview?: Opening | null
}>()

const editorStore = useEditorStore()
const layersStore = useLayersStore()

interface OpeningView {
  id: string
  /** SVG points of the wall-interruption rectangle. */
  interruption: string
  /** Jamb strokes across the wall thickness at both ends of the opening. */
  jambs: { a: Point; b: Point }[]
  /** Leaf/panel paths of the door symbol, per its style (empty for windows). */
  doorPaths: { d: string; dashed: boolean }[]
  /** Window glazing lines (empty for doors). */
  glazing: { a: Point; b: Point }[]
  /** Colour of the host wall, which the opening symbol reads in (spec S1f). */
  color: string
  selected: boolean
  preview: boolean
}

const DOOR_DASH_ARRAY = DOOR_DASH_IN.join(' ')

function pointsAttribute(points: readonly Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}

function buildView(
  opening: Opening,
  wall: Wall,
  presetsIn: readonly number[],
  selected: boolean,
  isPreview: boolean,
): OpeningView | null {
  // Inflate across the thickness so the interruption also covers the wall
  // outline strokes crossing the opening span.
  const inflated = openingWorldRect(wall, opening, props.hairline)
  const exact = openingWorldRect(wall, opening)
  if (!inflated || !exact) return null
  const door = opening.kind === 'door' ? doorFigure(wall, opening) : null
  return {
    id: opening.id,
    interruption: pointsAttribute(inflated),
    jambs: [
      { a: exact[0], b: exact[3] },
      { a: exact[1], b: exact[2] },
    ],
    doorPaths: (door?.strokes ?? []).map((stroke) => ({
      d: doorStrokeToPath(stroke),
      dashed: stroke.dashed,
    })),
    glazing: opening.kind === 'window' ? (windowSymbol(wall, opening) ?? []) : [],
    color: wallColor(wall, presetsIn),
    selected,
    preview: isPreview,
  }
}

const openingViews = computed<OpeningView[]>(() => {
  void editorStore.documentVersion
  const doc = editorStore.document
  if (!doc) return []
  const wallsById = new Map(doc.walls.map((wall) => [wall.id, wall]))
  const presetsIn = doc.thickness_presets_in
  const views: OpeningView[] = []
  for (const opening of doc.openings) {
    const wall = wallsById.get(opening.wall_id)
    if (!wall) continue
    const view = buildView(
      opening,
      wall,
      presetsIn,
      editorStore.isSelected({ kind: 'opening', id: opening.id }),
      false,
    )
    if (view) views.push(view)
  }
  if (props.preview) {
    const wall = wallsById.get(props.preview.wall_id)
    if (wall) {
      const view = buildView(props.preview, wall, presetsIn, false, true)
      if (view) views.push(view)
    }
  }
  return views
})

function symbolClass(view: OpeningView): string {
  if (view.preview) return 'stroke-accent'
  return view.selected ? 'stroke-accent-strong' : ''
}

/** Openings read in their host wall's colour, unless accented (spec S1f). */
function symbolStroke(view: OpeningView): string | undefined {
  return view.preview || view.selected ? undefined : view.color
}
</script>

<template>
  <g v-if="layersStore.structureVisible" aria-label="Openings">
    <g v-for="view in openingViews" :key="view.id" :opacity="view.preview ? 0.75 : 1">
      <polygon
        :points="view.interruption"
        :class="view.selected || view.preview ? 'fill-accent-soft' : 'fill-canvas'"
        stroke="none"
      />
      <line
        v-for="(jamb, index) in view.jambs"
        :key="`jamb-${index}`"
        :x1="jamb.a.x"
        :y1="jamb.a.y"
        :x2="jamb.b.x"
        :y2="jamb.b.y"
        :stroke="symbolStroke(view)"
        :class="symbolClass(view)"
        :stroke-width="(view.selected ? 1.5 : 1) * hairline"
      />
      <path
        v-for="(leaf, index) in view.doorPaths"
        :key="`leaf-${index}`"
        :d="leaf.d"
        fill="none"
        :stroke="symbolStroke(view)"
        :class="symbolClass(view)"
        :stroke-width="(view.selected ? 1.5 : 1) * hairline"
        :stroke-dasharray="leaf.dashed ? DOOR_DASH_ARRAY : undefined"
      />
      <line
        v-for="(pane, index) in view.glazing"
        :key="`glazing-${index}`"
        :x1="pane.a.x"
        :y1="pane.a.y"
        :x2="pane.b.x"
        :y2="pane.b.y"
        :stroke="symbolStroke(view)"
        :class="symbolClass(view)"
        :stroke-width="(view.selected ? 1.5 : 1) * hairline"
      />
    </g>
  </g>
</template>
