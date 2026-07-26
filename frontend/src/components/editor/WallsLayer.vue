<script setup lang="ts">
import { computed } from 'vue'

import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type { Point, Wall } from '@/types/plan'
import {
  angleOf,
  normalize,
  sub,
  trimEndpointToHostFace,
  wallFacePolylines,
  wallOutline,
} from '@/utils/geometry'
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
  d: string
  selected: boolean
  /** Dimmed while a reference-side preview replaces this wall (spec S1a). */
  dimmed: boolean
}

/**
 * Per-wall outline cache (spec E5). A wall's rendered path depends only on the
 * wall object and the host walls its junctions reference; the store replaces
 * only mutated wall objects (identity preserved for the rest), so a mutation
 * elsewhere lets unchanged walls reuse their cached path instead of recomputing
 * every outline on every document change.
 */
interface OutlineCacheEntry {
  hosts: readonly (Wall | undefined)[]
  d: string
}

const outlineCache = new WeakMap<Wall, OutlineCacheEntry>()

function hostsMatch(a: readonly (Wall | undefined)[], b: readonly (Wall | undefined)[]): boolean {
  if (a.length !== b.length) return false
  return a.every((host, index) => host === b[index])
}

/**
 * Render-time T-junction butting (spec S1b): endpoints carrying a junction
 * record are trimmed to the host wall's near face so the wall butts against
 * the host body instead of crossing it. The document keeps the endpoint on
 * the host's reference line.
 */
function renderVertices(wall: Wall, wallsById: ReadonlyMap<string, Wall>): Point[] {
  let vertices: Point[] = wall.vertices.map((v) => ({ ...v }))
  for (const junction of wall.junctions) {
    const host = wallsById.get(junction.host_wall_id)
    if (!host || host.id === wall.id) continue
    vertices = trimEndpointToHostFace(vertices, junction.end, {
      vertices: host.vertices,
      thicknessIn: host.thickness_in,
      reference: host.reference,
      closed: host.closed,
    })
  }
  return vertices
}

function outlineFor(wall: Wall, wallsById: ReadonlyMap<string, Wall>): string {
  const hosts = wall.junctions.map((junction) => wallsById.get(junction.host_wall_id))
  const cached = outlineCache.get(wall)
  if (cached && hostsMatch(cached.hosts, hosts)) return cached.d
  const d = ringsToPath(
    wallOutline({
      vertices: renderVertices(wall, wallsById),
      thicknessIn: wall.thickness_in,
      reference: wall.reference,
      closed: wall.closed,
    }),
  )
  outlineCache.set(wall, { hosts, d })
  return d
}

function wallsById(): ReadonlyMap<string, Wall> {
  const walls = editorStore.document?.walls ?? []
  return new Map(walls.map((wall) => [wall.id, wall]))
}

const wallPaths = computed<WallPath[]>(() => {
  // documentVersion is the store's explicit change signal for the shallowRef
  // document — touching it keys this computed on every mutation.
  void editorStore.documentVersion
  const walls = editorStore.document?.walls ?? []
  const byId = wallsById()
  const selectedIds = editorStore.selectedWallIds
  return walls
    .map((wall) => ({
      id: wall.id,
      d: outlineFor(wall, byId),
      selected: selectedIds.has(wall.id),
      dimmed: props.previewWall?.id === wall.id,
    }))
    .filter((path) => path.d !== '')
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

function identityFor(wall: Wall, byId: ReadonlyMap<string, Wall>): FaceIdentity | null {
  const vertices = renderVertices(wall, byId)
  const faces = wallFacePolylines({
    vertices,
    thicknessIn: wall.thickness_in,
    reference: wall.reference,
    closed: wall.closed,
  })
  if (faces.left.length === 0) return null
  const end = faces.closed ? vertices[0] : vertices[vertices.length - 1]
  const previous = faces.closed ? vertices[vertices.length - 1] : vertices[vertices.length - 2]
  const direction = normalize(sub(end, previous))
  const arrow =
    direction.x === 0 && direction.y === 0
      ? null
      : { point: end, angleDeg: (angleOf(direction) * 180) / Math.PI }
  return {
    id: wall.id,
    leftPath: polylineToPath(faces.left, faces.closed),
    rightPath: polylineToPath(faces.right, faces.closed),
    referencePath: polylineToPath(vertices, faces.closed),
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
  const byId = wallsById()
  const preview = props.previewWall ?? null
  const selectedIds = editorStore.selectedWallIds
  const identities: FaceIdentity[] = []
  for (const wall of walls) {
    if (!selectedIds.has(wall.id)) continue
    const source = preview?.id === wall.id ? preview : wall
    const identity = identityFor(source, byId)
    if (identity) identities.push(identity)
  }
  return identities
})

/** Ghost outline of the would-be geometry while a reference preview is live. */
const ghostPath = computed<string>(() => {
  const preview = props.previewWall
  if (!preview) return ''
  void editorStore.documentVersion
  return ringsToPath(
    wallOutline({
      vertices: renderVertices(preview, wallsById()),
      thicknessIn: preview.thickness_in,
      reference: preview.reference,
      closed: preview.closed,
    }),
  )
})
</script>

<template>
  <g v-if="layersStore.structureVisible" aria-label="Walls">
    <path
      v-for="wall in wallPaths"
      :key="wall.id"
      :d="wall.d"
      fill-rule="evenodd"
      :class="[
        wall.selected ? 'fill-accent/30 stroke-accent-strong' : 'fill-wall stroke-wall-edge',
        wall.dimmed ? 'opacity-40' : '',
      ]"
      :stroke-width="wall.selected ? 1.5 * hairline : hairline"
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
