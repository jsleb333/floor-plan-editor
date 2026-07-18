import type { Point } from '@/types/plan'

import { ALLOWED_DIRECTIONS } from './angles'
import { lineIntersection } from './lines'
import { add, distance, dot, scale, sub } from './vec'

/** The four distinct constraint LINES among the eight allowed directions (spec S1). */
const LINE_DIRECTIONS: readonly Point[] = ALLOWED_DIRECTIONS.slice(0, 4)

/**
 * Angle-preserving vertex-drag solver (spec S3): the dragged vertex is
 * constrained so every adjacent segment lies on an allowed 0°/45°/90°
 * direction.
 *
 * With two neighbours the candidates are the intersections of allowed-
 * direction lines through each neighbour; with one neighbour (open chain end)
 * they are the cursor's projections onto the allowed-direction lines through
 * that neighbour. The candidate nearest the cursor wins. With no neighbour
 * the cursor is returned unchanged.
 *
 * @param prev Neighbour vertex before the dragged one (wraps on closed loops), or null at a chain start.
 * @param next Neighbour vertex after the dragged one (wraps on closed loops), or null at a chain end.
 * @param cursor Raw drag cursor in world inches.
 */
export function constrainedVertexPosition(
  prev: Point | null,
  next: Point | null,
  cursor: Point,
): Point {
  if (prev && next) {
    let best: Point | null = null
    let bestDistance = Infinity
    for (const d1 of LINE_DIRECTIONS) {
      for (const d2 of LINE_DIRECTIONS) {
        const candidate = lineIntersection(prev, d1, next, d2)
        if (!candidate) continue
        const gap = distance(candidate, cursor)
        if (gap < bestDistance) {
          best = candidate
          bestDistance = gap
        }
      }
    }
    return best ?? { ...cursor }
  }

  const anchor = prev ?? next
  if (!anchor) return { ...cursor }
  let best: Point = { ...cursor }
  let bestDistance = Infinity
  for (const d of LINE_DIRECTIONS) {
    const candidate = add(anchor, scale(d, dot(sub(cursor, anchor), d)))
    const gap = distance(candidate, cursor)
    if (gap < bestDistance) {
      best = candidate
      bestDistance = gap
    }
  }
  return best
}
