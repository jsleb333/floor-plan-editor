import type { Point } from '@/types/plan'

import { EPSILON, add, cross, distance, dot, scale, sub } from './vec'

/** Result of projecting a point onto a segment (see `projectPointOnSegment`). */
export interface SegmentProjection {
  /** Closest point on the segment (computed with the clamped parameter). */
  point: Point
  /** Parameter along `a -> b`, clamped to [0, 1]. */
  t: number
  /** Unclamped parameter along `a -> b` (may fall outside [0, 1]). */
  tRaw: number
  /** Distance from the query point to `point`. */
  distance: number
}

/** Result of projecting a point onto a polyline (see `projectPointOnPolyline`). */
export interface PolylineProjection {
  /** Closest point on the polyline. */
  point: Point
  /** Index of the segment containing `point` (segment i joins vertices i and i+1). */
  segmentIndex: number
  /** Clamped parameter along that segment, in [0, 1]. */
  t: number
  /** Distance from the query point to `point`. */
  distance: number
}

/**
 * Intersection of two infinite lines given by point + direction.
 *
 * Returns `null` when the lines are parallel within `EPSILON` (including
 * collinear lines and zero-length directions).
 */
export function lineIntersection(p1: Point, d1: Point, p2: Point, d2: Point): Point | null {
  const denominator = cross(d1, d2)
  if (Math.abs(denominator) <= EPSILON) return null
  const t = cross(sub(p2, p1), d2) / denominator
  return add(p1, scale(d1, t))
}

/**
 * Intersection point of two closed segments `a1-a2` and `b1-b2`.
 *
 * Returns `null` when the segments do not touch or are parallel within
 * `EPSILON` (collinear overlaps are reported as `null`).
 */
export function segmentIntersection(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const dirA = sub(a2, a1)
  const dirB = sub(b2, b1)
  const denominator = cross(dirA, dirB)
  if (Math.abs(denominator) <= EPSILON) return null
  const offset = sub(b1, a1)
  const t = cross(offset, dirB) / denominator
  const s = cross(offset, dirA) / denominator
  if (t < -EPSILON || t > 1 + EPSILON || s < -EPSILON || s > 1 + EPSILON) return null
  return add(a1, scale(dirA, t))
}

/**
 * Orthogonal projection of `p` onto the segment `a -> b`.
 *
 * A degenerate segment (`a` ≈ `b`) projects onto `a` with `t = tRaw = 0`.
 */
export function projectPointOnSegment(p: Point, a: Point, b: Point): SegmentProjection {
  const dir = sub(b, a)
  const lengthSquared = dot(dir, dir)
  const tRaw = lengthSquared <= EPSILON * EPSILON ? 0 : dot(sub(p, a), dir) / lengthSquared
  const t = Math.min(1, Math.max(0, tRaw))
  const point = add(a, scale(dir, t))
  return { point, t, tRaw, distance: distance(p, point) }
}

/**
 * Closest point on an open polyline to `p`.
 *
 * Returns `null` when the polyline has fewer than 2 vertices. Ties between
 * segments resolve to the lowest segment index.
 */
export function projectPointOnPolyline(p: Point, vertices: Point[]): PolylineProjection | null {
  if (vertices.length < 2) return null
  let best: PolylineProjection | null = null
  for (let i = 0; i < vertices.length - 1; i++) {
    const projection = projectPointOnSegment(p, vertices[i], vertices[i + 1])
    if (best === null || projection.distance < best.distance - EPSILON) {
      best = {
        point: projection.point,
        segmentIndex: i,
        t: projection.t,
        distance: projection.distance,
      }
    }
  }
  return best
}
