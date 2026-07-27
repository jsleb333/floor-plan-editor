<script setup lang="ts">
import { computed } from 'vue'

import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type { Point, Wall } from '@/types/plan'
import {
  angleOf,
  normalize,
  resolveWallNetwork,
  sub,
  wallFacePolylines,
  geometryInputOf,
} from '@/utils/geometry'
import type { ResolvedNetwork } from '@/utils/geometry'
import { polylineToPath, ringsToPath } from '@/utils/svgPath'

/** Direction-arrow glyph pointing +x, tip at the origin; scaled by the hairline. */
const ARROW_PATH = 'M 0 0 L -8 3.5 L -8 -3.5 Z'
const START_MARKER_RADIUS_PX = 3
const FACE_STROKE_PX = 2.5

const props = defineProps<{
  /** World-unit stroke width rendering as ~1px on screen. */
  hairline: number
  /**
   * Transient would-be wall while the inspector previews a reference-side
   * change (spec S1a): its stored counterpart renders dimmed and this
   * geometry renders as a ghost outline with the face identity.
   */
  previewWall?: Wall | null
}>()

const editorStore = useEditorStore()
const layersStore = useLayersStore()

interface WallPath {
  id: string
  /** Body to fill; never stroked, so abutting bodies show no seam. */
  fill: string
  /** Only the outline edges no joined wall shares (`mergedBoundary.ts`). */
  stroke: string
  /** Dimmed while a reference-side preview replaces this wall (spec S1a). */
  dimmed: boolean
}

function serialize(polylines: readonly Point[][]): string {
  return polylines
    .map((polyline) => polylineToPath(polyline))
    .filter((path) => path !== '')
    .join(' ')
}

const network = computed<ResolvedNetwork>(() => editorStore.wallNetwork)

/** The network with the previewed wall substituted, so the ghost joins like the real thing. */
const previewNetwork = computed<ResolvedNetwork | null>(() => {
  const preview = props.previewWall
  if (!preview) return null
  void editorStore.documentVersion
  const walls = (editorStore.document?.walls ?? []).map((wall) =>
    wall.id === preview.id ? preview : wall,
  )
  return resolveWallNetwork(walls, editorStore.document?.joints ?? [])
})

const wallPaths = computed<WallPath[]>(() => {
  const resolved = network.value
  return (editorStore.document?.walls ?? [])
    .map((wall) => {
      const geometry = resolved.walls.get(wall.id)
      return {
        id: wall.id,
        fill: geometry ? ringsToPath(geometry.rings) : '',
        stroke: geometry ? serialize(geometry.strokes) : '',
        dimmed: props.previewWall?.id === wall.id,
      }
    })
    .filter((path) => path.fill !== '')
})

/** Bevel wedges between two walls, filled so an acute join has no notch. */
const gapPath = computed<string>(() =>
  ringsToPath(network.value.gaps.map((gap) => [...gap.points])),
)

/** Full outlines of the selected walls, drawn over the merged body as the highlight. */
const selectedPaths = computed<{ id: string; d: string }[]>(() => {
  const resolved = network.value
  const selectedIds = editorStore.selectedWallIds
  const paths: { id: string; d: string }[] = []
  for (const id of selectedIds) {
    const geometry = resolved.walls.get(id)
    if (geometry) paths.push({ id, d: ringsToPath(geometry.rings) })
  }
  return paths
})

/**
 * The S1a face visual identity of one selected wall: each derived face
 * stroked with its own tint, the reference line dashed with a start circle
 * and an end arrowhead marking the drawing direction.
 */
interface FaceIdentity {
  id: string
  leftPath: string
  rightPath: string
  referencePath: string
  start: Point
  arrow: { point: Point; angleDeg: number } | null
}

function identityFor(wall: Wall, resolved: ResolvedNetwork): FaceIdentity | null {
  const geometry = resolved.walls.get(wall.id)
  const faces = geometry ?? wallFacePolylines(geometryInputOf(wall))
  if (faces.left.length === 0) return null
  const vertices = wall.vertices
  const end = wall.closed ? vertices[0] : vertices[vertices.length - 1]
  const previous = wall.closed ? vertices[vertices.length - 1] : vertices[vertices.length - 2]
  const direction = normalize(sub(end, previous))
  const arrow =
    direction.x === 0 && direction.y === 0
      ? null
      : { point: end, angleDeg: (angleOf(direction) * 180) / Math.PI }
  return {
    id: wall.id,
    leftPath: polylineToPath(faces.left, wall.closed),
    rightPath: polylineToPath(faces.right, wall.closed),
    referencePath: polylineToPath(vertices, wall.closed),
    start: vertices[0],
    arrow,
  }
}

/**
 * Face identities of the selected walls (spec S1a); a reference-side preview
 * substitutes its would-be geometry for the stored wall's.
 */
const faceIdentities = computed<FaceIdentity[]>(() => {
  void editorStore.documentVersion
  const walls = editorStore.document?.walls ?? []
  const preview = props.previewWall ?? null
  const resolved = previewNetwork.value ?? network.value
  const selectedIds = editorStore.selectedWallIds
  const identities: FaceIdentity[] = []
  for (const wall of walls) {
    if (!selectedIds.has(wall.id)) continue
    const source = preview?.id === wall.id ? preview : wall
    const identity = identityFor(source, resolved)
    if (identity) identities.push(identity)
  }
  return identities
})

/** Ghost outline of the would-be geometry while a reference preview is live. */
const ghostPath = computed<string>(() => {
  const preview = props.previewWall
  const resolved = previewNetwork.value
  if (!preview || !resolved) return ''
  const geometry = resolved.walls.get(preview.id)
  return geometry ? ringsToPath(geometry.rings) : ''
})
</script>

<template>
  <g v-if="layersStore.structureVisible" aria-label="Walls">
    <path
      v-for="wall in wallPaths"
      :key="`fill-${wall.id}`"
      :d="wall.fill"
      fill-rule="evenodd"
      stroke="none"
      :class="['fill-wall', wall.dimmed ? 'opacity-40' : '']"
    />

    <path v-if="gapPath" :d="gapPath" fill-rule="nonzero" stroke="none" class="fill-wall" />

    <path
      v-for="wall in wallPaths"
      :key="`stroke-${wall.id}`"
      :d="wall.stroke"
      fill="none"
      :class="['stroke-wall-edge', wall.dimmed ? 'opacity-40' : '']"
      :stroke-width="hairline"
    />

    <path
      v-for="selected in selectedPaths"
      :key="`selected-${selected.id}`"
      :d="selected.d"
      fill-rule="evenodd"
      class="fill-accent/30 stroke-accent-strong"
      :stroke-width="1.5 * hairline"
    />

    <path
      v-if="ghostPath"
      :d="ghostPath"
      fill-rule="evenodd"
      class="fill-accent/10 stroke-accent"
      :stroke-width="hairline"
      :stroke-dasharray="`${4 * hairline} ${4 * hairline}`"
      aria-label="Reference change preview"
    />

    <g v-for="identity in faceIdentities" :key="identity.id" aria-label="Wall face identity">
      <path
        :d="identity.leftPath"
        fill="none"
        class="stroke-face-left/70"
        :stroke-width="FACE_STROKE_PX * hairline"
      />
      <path
        :d="identity.rightPath"
        fill="none"
        class="stroke-face-right/70"
        :stroke-width="FACE_STROKE_PX * hairline"
      />
      <path
        :d="identity.referencePath"
        fill="none"
        class="stroke-accent-strong/60"
        :stroke-width="hairline"
        :stroke-dasharray="`${3 * hairline} ${3 * hairline}`"
      />
      <circle
        :cx="identity.start.x"
        :cy="identity.start.y"
        :r="START_MARKER_RADIUS_PX * hairline"
        class="fill-surface stroke-accent-strong"
        :stroke-width="1.5 * hairline"
      />
      <path
        v-if="identity.arrow"
        :d="ARROW_PATH"
        :transform="`translate(${identity.arrow.point.x} ${identity.arrow.point.y}) rotate(${identity.arrow.angleDeg}) scale(${hairline})`"
        class="fill-accent-strong"
      />
    </g>
  </g>
</template>
