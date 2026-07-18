<script setup lang="ts">
import { computed } from 'vue'

import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type { Point, Wall } from '@/types/plan'
import { trimEndpointToHostFace, wallOutline } from '@/utils/geometry'
import { ringsToPath } from '@/utils/svgPath'

defineProps<{
  /** World-unit stroke width rendering as ~1px on screen. */
  hairline: number
}>()

const editorStore = useEditorStore()
const layersStore = useLayersStore()

interface WallPath {
  id: string
  d: string
  selected: boolean
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

const wallPaths = computed<WallPath[]>(() => {
  // documentVersion is the store's explicit change signal for the shallowRef
  // document — touching it keys this computed on every mutation.
  void editorStore.documentVersion
  const walls = editorStore.document?.walls ?? []
  const wallsById = new Map(walls.map((wall) => [wall.id, wall]))
  const selectedIds = editorStore.selectedWallIds
  return walls
    .map((wall) => ({
      id: wall.id,
      d: outlineFor(wall, wallsById),
      selected: selectedIds.has(wall.id),
    }))
    .filter((path) => path.d !== '')
})
</script>

<template>
  <g v-if="layersStore.structureVisible" aria-label="Walls">
    <path
      v-for="wall in wallPaths"
      :key="wall.id"
      :d="wall.d"
      fill-rule="evenodd"
      :class="wall.selected ? 'fill-accent/30 stroke-accent-strong' : 'fill-wall stroke-wall-edge'"
      :stroke-width="wall.selected ? 1.5 * hairline : hairline"
    />
  </g>
</template>
