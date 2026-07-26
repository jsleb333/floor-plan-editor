import type { Point } from '@/types/plan'

import { ALIGNMENT_LINE_DIRECTIONS, ALLOWED_DIRECTIONS } from './angles'
import { lineIntersection } from './lines'
import { EPSILON, add, cross, distance, dot, length, normalize, scale, sub } from './vec'

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

/**
 * Corrects a nearly-aligned chain end so the loop closes with one exact
 * segment (spec S1c).
 *
 * When the chain end sits within `toleranceIn` of an alignment line through
 * `startVertex`, closing directly would leave a slight kink and the
 * auto-square close would insert a sub-tolerance stub. Instead the chain end
 * is slid *along its final segment's line* (preserving that segment's angle
 * exactly) to the intersection with the alignment line — or projected
 * perpendicularly when the final segment is parallel to it. A candidate is
 * valid when the move stays within `toleranceIn`, the corrected closing
 * segment is non-degenerate, and the final segment keeps its direction and a
 * positive length. Returns the corrected chain end, or `null` when the close
 * is genuinely unaligned (the caller falls back to the auto-square close).
 */
export function alignedClose(
  segStart: Point,
  chainEnd: Point,
  startVertex: Point,
  toleranceIn: number,
): Point | null {
  const segment = sub(chainEnd, segStart)
  if (length(segment) <= EPSILON) return null
  const dir = normalize(segment)

  let best: Point | null = null
  let bestDisplacement = Infinity
  for (const lineDir of ALIGNMENT_LINE_DIRECTIONS) {
    const den = cross(dir, lineDir)
    const candidate =
      Math.abs(den) <= EPSILON
        ? add(startVertex, scale(lineDir, dot(sub(chainEnd, startVertex), lineDir)))
        : add(chainEnd, scale(dir, cross(sub(startVertex, chainEnd), lineDir) / den))
    const displacement = distance(candidate, chainEnd)
    if (displacement > toleranceIn || displacement >= bestDisplacement) continue
    if (distance(candidate, startVertex) <= EPSILON) continue
    if (dot(sub(candidate, segStart), dir) <= EPSILON) continue
    bestDisplacement = displacement
    best = candidate
  }
  return best
}
