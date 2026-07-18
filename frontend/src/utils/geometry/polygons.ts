import type { Point } from '@/types/plan'

/** Axis-aligned bounding box in world inches. */
export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Even-odd (ray casting) point-in-polygon test against a single closed ring
 * (no repeated last point). Points exactly on an edge may land on either side;
 * callers needing edge inclusion should grow the ring first.
 */
export function pointInPolygon(p: Point, ring: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    const crosses = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    if (crosses) inside = !inside
  }
  return inside
}

/**
 * Even-odd test across multiple rings, matching SVG `fill-rule="evenodd"`:
 * a point inside an odd number of rings is filled. This makes the hole of a
 * closed wall loop (inside both face rings) report as NOT inside, exactly like
 * the rendered wall body (spec E2 hit testing).
 */
export function pointInRings(p: Point, rings: readonly (readonly Point[])[]): boolean {
  let inside = false
  for (const ring of rings) {
    if (ring.length >= 3 && pointInPolygon(p, ring)) inside = !inside
  }
  return inside
}

/** Bounding box of a set of points; `null` when empty. */
export function boundsOfPoints(points: readonly Point[]): Bounds | null {
  if (points.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

/** Bounding box of all ring points combined; `null` when there are none. */
export function boundsOfRings(rings: readonly (readonly Point[])[]): Bounds | null {
  return boundsOfPoints(rings.flat())
}

/** True when the two boxes overlap or touch. */
export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY
}
