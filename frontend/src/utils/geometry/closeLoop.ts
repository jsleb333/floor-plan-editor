import type { Point } from '@/types/plan'

import { ALLOWED_DIRECTIONS } from './angles'
import { lineIntersection } from './lines'
import { EPSILON, dot, length, normalize, sub } from './vec'

/** Solution of an auto-square close (spec S1c). */
export interface SquareClose {
  /** The final corner vertex to insert before closing at the start vertex. */
  corner: Point
  /** Unit travel direction of the closing segment `corner -> startVertex`. */
  arrivalDir: Point
}

/**
 * Solves the auto-square close of a wall chain (spec S1c).
 *
 * The chain currently ends at `prevVertex`, heading along the constrained
 * direction `currentDir`; the loop must close exactly at `startVertex`. Each
 * of the eight `ALLOWED_DIRECTIONS` is tried as the closing segment's travel
 * direction into `startVertex`: the corner is the intersection of the current
 * heading line with the arrival line. A candidate is valid when the corner
 * lies strictly ahead of `prevVertex` and the arrival segment
 * `corner -> startVertex` is non-degenerate. Among valid candidates the one
 * minimizing the total added length is returned; `null` when none exists
 * (the caller falls back to a direct free segment).
 */
export function autoSquareClose(
  prevVertex: Point,
  currentDir: Point,
  startVertex: Point,
): SquareClose | null {
  if (length(currentDir) <= EPSILON) return null
  const heading = normalize(currentDir)

  let best: SquareClose | null = null
  let bestAddedLength = Infinity
  for (const arrivalDir of ALLOWED_DIRECTIONS) {
    const corner = lineIntersection(prevVertex, heading, startVertex, arrivalDir)
    if (corner === null) continue
    const distanceToCorner = dot(sub(corner, prevVertex), heading)
    if (distanceToCorner <= EPSILON) continue
    const arrivalLength = dot(sub(startVertex, corner), arrivalDir)
    if (arrivalLength <= EPSILON) continue
    const addedLength = distanceToCorner + arrivalLength
    if (addedLength < bestAddedLength - EPSILON) {
      bestAddedLength = addedLength
      best = { corner, arrivalDir }
    }
  }
  return best
}
