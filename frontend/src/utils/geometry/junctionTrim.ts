import type { Point } from '@/types/plan'

import { EPSILON, add, cross, dot, normalize, scale, sub } from './vec'
import { offsetPolyline, wallFaceOffsets } from './wallOutline'
import type { WallGeometryInput } from './wallOutline'

/**
 * A trim may move the endpoint at most this many host thicknesses along the
 * wall; farther face hits mean the junction record is stale (host moved away)
 * and the endpoint is left untouched.
 */
const MAX_TRIM_FACTOR = 2

/**
 * Trims (or extends) one endpoint of a wall's reference polyline to the
 * nearest FACE of a host wall, so a T-junction butts against the host body
 * instead of crossing to its reference line (spec S1b polish). Render-derived
 * only — the stored document keeps the endpoint on the host reference line.
 *
 * The endpoint slides along its own end-segment direction to the first host
 * face crossed when travelling outward from the inner neighbour vertex. When
 * no face lies on that ray (odd angles, endpoint past the host) the vertices
 * are returned unchanged.
 *
 * @param vertices Reference-line vertices of the butting wall.
 * @param end Which endpoint carries the junction.
 * @param host Geometry of the host wall the endpoint lives on.
 */
export function trimEndpointToHostFace(
  vertices: readonly Point[],
  end: 'start' | 'end',
  host: WallGeometryInput,
): Point[] {
  const result = vertices.map((v) => ({ ...v }))
  if (vertices.length < 2) return result
  const endpointIndex = end === 'start' ? 0 : vertices.length - 1
  const innerIndex = end === 'start' ? 1 : vertices.length - 2
  const inner = vertices[innerIndex]
  const endpoint = vertices[endpointIndex]
  const direction = normalize(sub(endpoint, inner))
  if (Math.abs(direction.x) <= EPSILON && Math.abs(direction.y) <= EPSILON) return result

  const hit = nearestFaceHit(inner, direction, dot(sub(endpoint, inner), direction), host)
  if (hit) result[endpointIndex] = hit
  return result
}

/**
 * First intersection of the ray `origin + s·direction` (s > 0) with either
 * host face, rejected when it lands farther than `MAX_TRIM_FACTOR` host
 * thicknesses from the current endpoint (`endpointAlong` on the same ray).
 */
function nearestFaceHit(
  origin: Point,
  direction: Point,
  endpointAlong: number,
  host: WallGeometryInput,
): Point | null {
  const [leftDistance, rightDistance] = wallFaceOffsets(host.reference, host.thicknessIn)
  const closed = host.closed ?? false
  let bestAlong = Infinity
  let best: Point | null = null

  for (const offset of [leftDistance, rightDistance]) {
    const face = offsetPolyline([...host.vertices], offset, closed)
    const segmentEnd = closed ? face.length : face.length - 1
    for (let i = 0; i < segmentEnd; i++) {
      const a = face[i]
      const b = face[(i + 1) % face.length]
      const faceDir = sub(b, a)
      const denominator = cross(direction, faceDir)
      if (Math.abs(denominator) <= EPSILON) continue
      const rel = sub(a, origin)
      const along = cross(rel, faceDir) / denominator
      const onFace = cross(rel, direction) / denominator
      if (along <= EPSILON || onFace < -EPSILON || onFace > 1 + EPSILON) continue
      if (Math.abs(along - endpointAlong) > MAX_TRIM_FACTOR * host.thicknessIn) continue
      if (along < bestAlong) {
        bestAlong = along
        best = add(origin, scale(direction, along))
      }
    }
  }
  return best
}
