import type { Device, Point, Wall } from '@/types/plan'

import { deviceWorldPlacement } from './devices'
import { projectPointOnSegment } from './lines'
import { add, distance, lerp, normalize, perpendicular, scale, sub } from './vec'

/**
 * Cubic-Bézier wire geometry (spec W2/W3). Endpoints are the live world centres
 * of the connected devices (so wires follow devices, spec W3); the two interior
 * control points are absolute plan coordinates. Pure functions shared by the
 * wire tool, the renderer and hit-testing so the drawn curve is the one you
 * click.
 */

/** Perpendicular offset of the auto-curve, as a fraction of the endpoint distance. */
export const AUTO_CURVE_FACTOR = 0.15
/** Sample count used to approximate a wire for hit-testing. */
export const WIRE_HIT_SAMPLES = 24

/**
 * The default gentle auto-curve (spec W2): two control points at 1/3 and 2/3
 * along the segment, offset perpendicular by 15 % of the endpoint distance,
 * consistently to the LEFT of the `from -> to` direction so the result is
 * deterministic. A zero-length span yields both control points at `from`.
 *
 * @param from World centre of the source device.
 * @param to World centre of the target device.
 */
export function autoCurveControlPoints(from: Point, to: Point): [Point, Point] {
  const span = sub(to, from)
  const len = distance(from, to)
  if (len <= 0) return [{ ...from }, { ...from }]
  const offset = scale(perpendicular(normalize(span)), len * AUTO_CURVE_FACTOR)
  return [add(lerp(from, to, 1 / 3), offset), add(lerp(from, to, 2 / 3), offset)]
}

/** The world centre a wire attaches to for a device, or `null` when unresolved. */
export function wireEndpoint(device: Device | undefined, walls: readonly Wall[]): Point | null {
  if (!device) return null
  const placement = deviceWorldPlacement(device, walls)
  return placement ? placement.position : null
}

/** A point on the cubic Bézier `p0 p1 p2 p3` at parameter `t` in [0, 1]. */
function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  }
}

/** The ordered spline vertices: the two endpoints with the control points between. */
function splineVertices(from: Point, controlPoints: readonly Point[], to: Point): Point[] {
  return [from, ...controlPoints, to]
}

/**
 * SVG path data for a wire. With the tool's canonical two control points this
 * is a single cubic; any other count falls back to a smooth Catmull-Rom spline
 * through the endpoints and control points so hand-edited wires still render.
 *
 * @param from World centre of the source device.
 * @param controlPoints The wire's interior control points.
 * @param to World centre of the target device.
 */
export function wirePathData(from: Point, controlPoints: readonly Point[], to: Point): string {
  if (controlPoints.length === 2) {
    const [c1, c2] = controlPoints
    return `M ${from.x} ${from.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}`
  }
  const points = splineVertices(from, controlPoints, to)
  if (points.length < 2) return ''
  let path = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    path += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`
  }
  return path
}

/**
 * Samples `count + 1` points along a wire, for hit-testing and overlays. Uses
 * the same cubic (two control points) or Catmull-Rom fallback as the renderer.
 */
export function sampleWirePoints(
  from: Point,
  controlPoints: readonly Point[],
  to: Point,
  count: number = WIRE_HIT_SAMPLES,
): Point[] {
  const steps = Math.max(1, count)
  const result: Point[] = []
  if (controlPoints.length === 2) {
    const [c1, c2] = controlPoints
    for (let i = 0; i <= steps; i++) result.push(cubicAt(from, c1, c2, to, i / steps))
    return result
  }
  const points = splineVertices(from, controlPoints, to)
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    const segSteps = Math.max(1, Math.round(steps / (points.length - 1)))
    for (let s = 0; s <= segSteps; s++) result.push(cubicAt(p1, c1, c2, p2, s / segSteps))
  }
  return result
}

/**
 * Minimum distance from `point` to a wire, approximated by sampling the curve
 * and measuring to the sampled polyline (spec W2 selection). Returns `Infinity`
 * for a degenerate wire.
 *
 * @param point The query point (world coordinates).
 * @param from World centre of the source device.
 * @param controlPoints The wire's interior control points.
 * @param to World centre of the target device.
 * @param samples Curve sample count (more = more accurate, defaults to 24).
 */
export function wireHitDistance(
  point: Point,
  from: Point,
  controlPoints: readonly Point[],
  to: Point,
  samples: number = WIRE_HIT_SAMPLES,
): number {
  const pts = sampleWirePoints(from, controlPoints, to, samples)
  let best = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const projection = projectPointOnSegment(point, pts[i], pts[i + 1])
    if (projection.distance < best) best = projection.distance
  }
  return best
}
