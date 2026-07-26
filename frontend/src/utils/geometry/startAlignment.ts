import type { Point } from '@/types/plan'

import { ALIGNMENT_LINE_DIRECTIONS } from './angles'
import { EPSILON, add, cross, distance, dot, normalize, scale, sub } from './vec'

/** An alignment-with-chain-start snap solution (spec S1c). */
export interface StartAlignment {
  /** Snapped point, exactly on one of the four alignment lines through the start. */
  point: Point
  /** Unit direction of that alignment line, oriented from the start toward `point`. */
  guideDir: Point
}

/**
 * Aligns an angle-constrained pending point with the chain's start vertex
 * (spec S1c).
 *
 * The pending point is confined to the ray `rayOrigin + t * rayDir` (the
 * angle-snapped drawing direction) and currently sits at `alongIn` inches
 * along it. Each of the four alignment lines through `start` is intersected
 * with the ray; a crossing is a candidate when it lies strictly ahead of the
 * ray origin and does not coincide with `start` itself (that spot belongs to
 * the close affordance). The candidate that moves the point the least is
 * returned when that move is within `toleranceIn`; `null` otherwise.
 */
export function alignOnRay(
  rayOrigin: Point,
  rayDir: Point,
  start: Point,
  alongIn: number,
  toleranceIn: number,
): StartAlignment | null {
  let best: StartAlignment | null = null
  let bestShift = Infinity
  for (const lineDir of ALIGNMENT_LINE_DIRECTIONS) {
    const den = cross(rayDir, lineDir)
    if (Math.abs(den) <= EPSILON) continue
    const t = cross(sub(start, rayOrigin), lineDir) / den
    if (t <= EPSILON) continue
    const point = add(rayOrigin, scale(rayDir, t))
    if (distance(point, start) <= EPSILON) continue
    const shift = Math.abs(t - alongIn)
    if (shift <= toleranceIn && shift < bestShift) {
      bestShift = shift
      best = { point, guideDir: normalize(sub(point, start)) }
    }
  }
  return best
}

/**
 * Aligns a free (unconstrained) pending point with the chain's start vertex
 * (spec S1c).
 *
 * The cursor is projected perpendicularly onto each of the four alignment
 * lines through `start`; the nearest projection within `toleranceIn` is
 * returned, skipping projections that coincide with `start` itself. `null`
 * when every line is out of reach.
 */
export function alignFree(cursor: Point, start: Point, toleranceIn: number): StartAlignment | null {
  let best: StartAlignment | null = null
  let bestShift = Infinity
  for (const lineDir of ALIGNMENT_LINE_DIRECTIONS) {
    const offset = sub(cursor, start)
    const shift = Math.abs(cross(offset, lineDir))
    if (shift > toleranceIn || shift >= bestShift) continue
    const point = add(start, scale(lineDir, dot(offset, lineDir)))
    if (distance(point, start) <= EPSILON) continue
    bestShift = shift
    best = { point, guideDir: normalize(sub(point, start)) }
  }
  return best
}
