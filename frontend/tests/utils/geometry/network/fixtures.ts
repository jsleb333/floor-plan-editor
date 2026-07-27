import type { Point, Wall, WallEnd } from '@/types/plan'
import type { ResolvedEnd, ResolvedNetwork, ResolvedWall, WallReference } from '@/utils/geometry'

/** A wall with the fields this phase does not exercise defaulted. */
export function wall(
  id: string,
  vertices: Point[],
  thicknessIn: number,
  reference: WallReference = 'center',
  closed = false,
): Wall {
  return {
    id,
    vertices,
    thickness_in: thicknessIn,
    reference,
    closed,
    locked_segments: [],
    junctions: [],
  }
}

/** The resolved wall, failing loudly rather than asserting non-null at each use. */
export function resolvedWall(network: ResolvedNetwork, id: string): ResolvedWall {
  const resolved = network.walls.get(id)
  if (!resolved) throw new Error(`wall ${id} did not resolve`)
  return resolved
}

/** One resolved end of a wall; a ring has none. */
export function resolvedEnd(network: ResolvedNetwork, id: string, end: WallEnd): ResolvedEnd {
  const resolved = resolvedWall(network, id).ends[end]
  if (!resolved) throw new Error(`wall ${id} has no free ${end}`)
  return resolved
}
