import type { Point } from '@/types/plan'

import { lineIntersection } from './lines'
import { EPSILON, add, cross, distance, dot, normalize, perpendicular, scale, sub } from './vec'

/** Mitre joins farther than this many times the offset distance from the vertex fall back to a bevel. */
const MITRE_LIMIT_FACTOR = 4

/**
 * Which face of the wall the drawn polyline is (spec S1a), relative to the
 * drawing direction in y-down space:
 * - 'center': faces are offset ±thickness/2 on both sides.
 * - 'left': the reference line IS the left face; the body grows to the RIGHT of travel.
 * - 'right': the reference line IS the right face; the body grows to the LEFT of travel.
 */
export type WallReference = 'center' | 'left' | 'right'

/** Everything needed to derive a wall's rendered outline from its stored geometry (spec §4.1). */
export interface WallGeometryInput {
  /**
   * Reference-line vertices, in inches. A closed loop is expressed either by
   * `closed: true` or by repeating the first vertex at the end.
   */
  vertices: Point[]
  /** Wall thickness in inches (> 0). */
  thicknessIn: number
  /** Reference side (see `WallReference`). */
  reference: WallReference
  /** Marks the chain as a closed loop without repeating the first vertex. */
  closed?: boolean
}

/**
 * Offsets a polyline perpendicular to itself by `signedDistance`.
 *
 * Sign convention: POSITIVE offsets toward the LEFT of the travel direction
 * (see `perpendicular`), negative toward the right. Consecutive segments join
 * at the mitre point (intersection of the adjacent offset lines); collinear
 * segments keep the plain offset point; joins whose mitre point lies farther
 * than `4 × |signedDistance|` from the vertex (extremely acute angles) fall
 * back to a bevel, emitting both offset endpoints.
 *
 * With `closed` the vertices are treated as a ring (no repeated first vertex)
 * and every vertex — including the first — is a join.
 *
 * Consecutive duplicate vertices are ignored; fewer than 2 distinct vertices
 * returns the distinct vertices unchanged.
 */
export function offsetPolyline(vertices: Point[], signedDistance: number, closed = false): Point[] {
  const points = dedupeConsecutive(vertices, closed)
  if (points.length < 2) return points
  const directions = segmentDirections(points, closed)

  const result: Point[] = []
  if (closed) {
    for (let i = 0; i < points.length; i++) {
      const previous = directions[(i + directions.length - 1) % directions.length]
      result.push(...joinAt(points[i], previous, directions[i], signedDistance))
    }
  } else {
    result.push(offsetPoint(points[0], directions[0], signedDistance))
    for (let i = 1; i < points.length - 1; i++) {
      result.push(...joinAt(points[i], directions[i - 1], directions[i], signedDistance))
    }
    result.push(
      offsetPoint(points[points.length - 1], directions[directions.length - 1], signedDistance),
    )
  }
  return result
}

/**
 * A wall's two derived face polylines, each walked in the drawing direction
 * (spec S1a). `left` is the walker's-left face in y-down space, `right` the
 * walker's-right face, for every reference mode. With `closed` both are rings
 * without a repeated last point.
 */
export interface WallFacePolylines {
  left: Point[]
  right: Point[]
  closed: boolean
}

/**
 * Derives a wall's outline polygon(s) from its reference line (specs S1a/S1b).
 *
 * Returns closed rings without a repeated last point:
 * - Open chain: one ring — the left face walked forward then the right face
 *   walked back, with square butt caps at both free ends.
 * - Closed loop: two rings — `[leftFaceRing, rightFaceRing]` (which one is
 *   outer depends on the loop's winding).
 *
 * Returns `[]` when there are fewer than 2 distinct vertices (3 for a closed
 * loop). Throws `RangeError` for a non-positive thickness.
 */
export function wallOutline(input: WallGeometryInput): Point[][] {
  const faces = wallFacePolylines(input)
  if (faces.left.length === 0) return []
  if (faces.closed) return [faces.left, faces.right]
  return [[...faces.left, ...faces.right.reverse()]]
}

/**
 * Derives a wall's two face polylines from its reference line (spec S1a),
 * each walked in the drawing direction so `left`/`right` stay the walker's
 * left and right whatever the reference mode. The face-identity overlays
 * stroke these to tint each side consistently.
 *
 * Returns empty faces when there are fewer than 2 distinct vertices (3 for a
 * closed loop). Throws `RangeError` for a non-positive thickness.
 */
export function wallFacePolylines(input: WallGeometryInput): WallFacePolylines {
  if (!(input.thicknessIn > 0)) {
    throw new RangeError(`Wall thickness must be positive, got ${input.thicknessIn}`)
  }
  let points = dedupeConsecutive(input.vertices, false)
  let closed = input.closed ?? false
  if (points.length >= 2 && distance(points[0], points[points.length - 1]) <= EPSILON) {
    points = points.slice(0, -1)
    closed = true
  }
  if (points.length < (closed ? 3 : 2)) return { left: [], right: [], closed }

  const [leftDistance, rightDistance] = wallFaceOffsets(input.reference, input.thicknessIn)
  return {
    left: offsetPolyline(points, leftDistance, closed),
    right: offsetPolyline(points, rightDistance, closed),
    closed,
  }
}

/** Signed offsets `[leftFace, rightFace]` from the reference line (positive = left of travel). */
export function wallFaceOffsets(reference: WallReference, thickness: number): [number, number] {
  switch (reference) {
    case 'center':
      return [thickness / 2, -thickness / 2]
    case 'left':
      return [0, -thickness]
    case 'right':
      return [thickness, 0]
  }
}

/** Removes consecutive (and for rings, wrap-around) duplicate vertices. */
function dedupeConsecutive(vertices: Point[], closed: boolean): Point[] {
  const points: Point[] = []
  for (const vertex of vertices) {
    const last = points[points.length - 1]
    if (last === undefined || distance(last, vertex) > EPSILON) points.push(vertex)
  }
  if (closed && points.length >= 2 && distance(points[0], points[points.length - 1]) <= EPSILON) {
    points.pop()
  }
  return points
}

/** Unit direction of each segment; for rings the last segment wraps back to the first vertex. */
function segmentDirections(points: Point[], closed: boolean): Point[] {
  const directions: Point[] = []
  const count = closed ? points.length : points.length - 1
  for (let i = 0; i < count; i++) {
    directions.push(normalize(sub(points[(i + 1) % points.length], points[i])))
  }
  return directions
}

/** The vertex offset perpendicular to a segment direction. */
function offsetPoint(vertex: Point, direction: Point, offset: number): Point {
  return add(vertex, scale(perpendicular(direction), offset))
}

/**
 * Join of two adjacent offset segments at their shared vertex: the mitre
 * point when it exists and is within the mitre limit, otherwise a bevel
 * (both offset endpoints). Collinear continuations keep the single offset point.
 */
function joinAt(vertex: Point, previous: Point, next: Point, offset: number): Point[] {
  const fromPrevious = offsetPoint(vertex, previous, offset)
  const fromNext = offsetPoint(vertex, next, offset)
  if (Math.abs(cross(previous, next)) <= EPSILON) {
    if (dot(previous, next) > 0) return [fromPrevious]
    return [fromPrevious, fromNext]
  }
  const mitre = lineIntersection(fromPrevious, previous, fromNext, next)
  if (mitre === null) return [fromPrevious, fromNext]
  if (
    Math.abs(offset) > EPSILON &&
    distance(mitre, vertex) > MITRE_LIMIT_FACTOR * Math.abs(offset)
  ) {
    return [fromPrevious, fromNext]
  }
  return [mitre]
}
