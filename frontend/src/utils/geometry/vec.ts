import type { Point } from '@/types/plan'

/**
 * 2D vector primitives for the floor-plan geometry module.
 *
 * Coordinate convention (shared by every module in `utils/geometry/`):
 * - x grows RIGHT, y grows DOWN (SVG screen space); units are inches.
 * - Angles are in radians from the +x axis, increasing toward +y
 *   (i.e. clockwise on screen).
 * - For a walker travelling from `a` to `b`, a point `p` is on the walker's
 *   LEFT when `cross(sub(b, a), sub(p, a))` is NEGATIVE — up-screen when
 *   walking east. See `sideOf`.
 * - `perpendicular` rotates a vector 90° toward that left side, so
 *   `add(a, perpendicular(sub(b, a)))` is always left of the walk `a -> b`.
 */

/** Tolerance below which lengths, cross products and parameters are treated as zero. */
export const EPSILON = 1e-9

/** Which side of a directed line a point lies on, in y-down screen space. */
export type Side = 'left' | 'right' | 'on'

/** Component-wise sum `a + b`. */
export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y }
}

/** Component-wise difference `a - b`. */
export function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

/** Scalar multiple `v * factor`. */
export function scale(v: Point, factor: number): Point {
  return { x: v.x * factor, y: v.y * factor }
}

/** Dot product `a · b`. */
export function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y
}

/**
 * Z component of the 3D cross product `a × b`.
 *
 * In y-down space a positive value means `b` points to the RIGHT of `a`
 * (clockwise on screen), negative means LEFT.
 */
export function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x
}

/** Euclidean length of `v`. */
export function length(v: Point): number {
  return Math.hypot(v.x, v.y)
}

/** Euclidean distance between `a` and `b`. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** Unit vector in the direction of `v`, or `{x: 0, y: 0}` when `v` is (near) zero-length. */
export function normalize(v: Point): Point {
  const len = length(v)
  if (len <= EPSILON) return { x: 0, y: 0 }
  return { x: v.x / len, y: v.y / len }
}

/**
 * `v` rotated 90° toward the LEFT of its direction in y-down space
 * (a -90° rotation: east `(1,0)` becomes up-screen `(0,-1)`).
 */
export function perpendicular(v: Point): Point {
  return { x: v.y, y: -v.x }
}

/** Angle of `v` in radians from the +x axis toward +y, in `(-π, π]`. */
export function angleOf(v: Point): number {
  return Math.atan2(v.y, v.x)
}

/** Unit vector at `angle` radians from the +x axis toward +y. */
export function dirFromAngle(angle: number): Point {
  return { x: Math.cos(angle), y: Math.sin(angle) }
}

/** Linear interpolation from `a` to `b` by factor `t` (unclamped). */
export function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/**
 * Side of the directed line `a -> b` on which `p` lies.
 *
 * 'left' is the walker's left in y-down space (negative cross product),
 * 'on' means within `EPSILON` of the line.
 */
export function sideOf(a: Point, b: Point, p: Point): Side {
  const z = cross(sub(b, a), sub(p, a))
  if (z < -EPSILON) return 'left'
  if (z > EPSILON) return 'right'
  return 'on'
}
