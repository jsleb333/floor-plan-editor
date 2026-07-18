import type { Point, Stairs } from '@/types/plan'

import { add, dirFromAngle, normalize, perpendicular, scale, sub } from './vec'

/** Approximate tread depth (spec S6): one tread line every ~10" along the run. */
const TREAD_SPACING_IN = 10
/** Arrow inset from each end of the run, as a fraction of the length. */
const ARROW_INSET_FRACTION = 0.12

const DEG_TO_RAD = Math.PI / 180

/** The local frame of a stair run: `u` along the run, `v` across it (right of travel). */
export interface StairsFrame {
  origin: Point
  u: Point
  v: Point
}

/** Resolves a stair run's rotation into its local frame. */
export function stairsFrame(stairs: Stairs): StairsFrame {
  const u = dirFromAngle(stairs.rotation_deg * DEG_TO_RAD)
  return { origin: stairs.origin, u, v: scale(perpendicular(u), -1) }
}

/**
 * The 4 world-space corners of a stair run's rectangle: `origin`, then along
 * the run (`length_in`), then across it (`width_in`), counter-corner last.
 */
export function stairsCorners(stairs: Stairs): Point[] {
  const { origin, u, v } = stairsFrame(stairs)
  const along = scale(u, stairs.length_in)
  const across = scale(v, stairs.width_in)
  return [origin, add(origin, along), add(origin, add(along, across)), add(origin, across)]
}

/** Tread lines across the run's width, one every ~10 inches (spec S6). */
export function stairsTreads(stairs: Stairs): { a: Point; b: Point }[] {
  const { origin, u, v } = stairsFrame(stairs)
  const across = scale(v, stairs.width_in)
  const count = Math.floor(stairs.length_in / TREAD_SPACING_IN)
  const treads: { a: Point; b: Point }[] = []
  for (let i = 1; i <= count; i++) {
    const at = add(origin, scale(u, i * TREAD_SPACING_IN))
    if (i * TREAD_SPACING_IN >= stairs.length_in) break
    treads.push({ a: at, b: add(at, across) })
  }
  return treads
}

/**
 * Direction arrow along the run's centreline: points along the run for 'up',
 * back toward the origin for 'down' (spec S6).
 */
export function stairsArrow(stairs: Stairs): { tail: Point; head: Point } {
  const { origin, u, v } = stairsFrame(stairs)
  const centre = scale(v, stairs.width_in / 2)
  const tail = add(add(origin, scale(u, stairs.length_in * ARROW_INSET_FRACTION)), centre)
  const head = add(add(origin, scale(u, stairs.length_in * (1 - ARROW_INSET_FRACTION))), centre)
  return stairs.direction === 'up' ? { tail, head } : { tail: head, head: tail }
}

/** Centre point of the stair rectangle (label anchor). */
export function stairsCenter(stairs: Stairs): Point {
  const { origin, u, v } = stairsFrame(stairs)
  return add(origin, add(scale(u, stairs.length_in / 2), scale(v, stairs.width_in / 2)))
}

/** The two chevron strokes of the arrow head, for rendering. */
export function arrowHeadStrokes(
  tail: Point,
  head: Point,
  sizeIn: number,
): { a: Point; b: Point }[] {
  const u = normalize(sub(head, tail))
  const n = perpendicular(u)
  const back = add(head, scale(u, -sizeIn))
  return [
    { a: add(back, scale(n, sizeIn / 2)), b: head },
    { a: add(back, scale(n, -sizeIn / 2)), b: head },
  ]
}
