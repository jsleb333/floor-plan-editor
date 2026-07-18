import type { Opening, Point, Wall } from '@/types/plan'

import { projectPointOnPolyline } from './lines'
import { add, cross, distance, normalize, perpendicular, scale, sub } from './vec'
import { wallFaceOffsets } from './wallOutline'

/**
 * Parametric opening geometry (spec §4.2): doors and windows store a host
 * address `{wall_id, segment_index, t}` and every world-space shape here is
 * DERIVED from the host wall's current reference line — never persisted.
 */

/** One wall segment resolved to world space, with its reference-line length. */
export interface WallSegmentSpan {
  a: Point
  b: Point
  lengthIn: number
}

/** A candidate host address for an opening near the cursor (spec S4/S5 placement). */
export interface WallPlacement {
  wallId: string
  segmentIndex: number
  /** Inches along the host segment's reference line from its start vertex. */
  tIn: number
  /** Projected point on the reference line. */
  point: Point
  /** Distance from the query point to `point`. */
  distanceIn: number
}

/** The door swing symbol: leaf line from `hinge` to `leafEnd`, arc to `arcEnd` (spec S4). */
export interface DoorSymbol {
  hinge: Point
  leafEnd: Point
  arcEnd: Point
  radiusIn: number
  /** SVG sweep flag for the arc drawn from `leafEnd` to `arcEnd` around `hinge`. */
  sweep: 0 | 1
}

/** Number of reference-line segments of a wall chain. */
export function wallSegmentCount(wall: Wall): number {
  return wall.closed ? wall.vertices.length : wall.vertices.length - 1
}

/** Resolves segment `segmentIndex` of a wall to world space; `null` when out of range. */
export function wallSegmentSpan(wall: Wall, segmentIndex: number): WallSegmentSpan | null {
  if (segmentIndex < 0 || segmentIndex >= wallSegmentCount(wall)) return null
  const a = wall.vertices[segmentIndex]
  const b = wall.vertices[(segmentIndex + 1) % wall.vertices.length]
  return { a, b, lengthIn: distance(a, b) }
}

/**
 * Clamps an opening centre so the whole opening stays within its segment
 * (spec §4.2: attachments clamp, nothing floats). A segment shorter than the
 * opening centres it.
 */
export function clampOpeningT(t: number, widthIn: number, segmentLengthIn: number): number {
  const half = widthIn / 2
  if (segmentLengthIn <= widthIn) return segmentLengthIn / 2
  return Math.min(Math.max(t, half), segmentLengthIn - half)
}

/**
 * World-space rectangle of an opening: its span along the host reference line
 * crossed with the wall thickness, as 4 corners `[startLeft, endLeft, endRight,
 * startRight]` ('left'/'right' of the segment's travel direction).
 *
 * @param wall The host wall.
 * @param opening The opening; `t` is clamped to the segment (spec §4.2).
 * @param inflateAcrossIn Grows the rectangle across the wall thickness on both
 *   faces (used to fully cover the wall outline stroke when painting the
 *   interruption). Defaults to 0.
 */
export function openingWorldRect(
  wall: Wall,
  opening: Opening,
  inflateAcrossIn = 0,
): Point[] | null {
  const jambs = openingJambs(wall, opening)
  if (!jambs) return null
  const { start, end, normal } = jambs
  const [leftOffset, rightOffset] = wallFaceOffsets(wall.reference, wall.thickness_in)
  const left = leftOffset + inflateAcrossIn
  const right = rightOffset - inflateAcrossIn
  return [
    add(start, scale(normal, left)),
    add(end, scale(normal, left)),
    add(end, scale(normal, right)),
    add(start, scale(normal, right)),
  ]
}

/**
 * The two jamb points of an opening on the host reference line, plus the
 * segment frame (`unit` along travel, `normal` toward the left of travel).
 */
export function openingJambs(
  wall: Wall,
  opening: Opening,
): { start: Point; end: Point; unit: Point; normal: Point } | null {
  const span = wallSegmentSpan(wall, opening.segment_index)
  if (!span || span.lengthIn <= 0) return null
  const unit = normalize(sub(span.b, span.a))
  const t = clampOpeningT(opening.t, opening.width_in, span.lengthIn)
  const half = Math.min(opening.width_in, span.lengthIn) / 2
  return {
    start: add(span.a, scale(unit, t - half)),
    end: add(span.a, scale(unit, t + half)),
    unit,
    normal: perpendicular(unit),
  }
}

/**
 * Conventional door symbol (spec S4): the leaf hinged at the `hinge`-side jamb,
 * swung perpendicular to the wall toward the `swing` side ('in' = left of the
 * segment's travel direction), plus the quarter-circle arc from the leaf tip
 * back to the opposite jamb. `null` for degenerate segments.
 */
export function doorSymbol(wall: Wall, opening: Opening): DoorSymbol | null {
  const jambs = openingJambs(wall, opening)
  if (!jambs) return null
  const hinge = opening.hinge === 'left' ? jambs.start : jambs.end
  const arcEnd = opening.hinge === 'left' ? jambs.end : jambs.start
  const radiusIn = distance(jambs.start, jambs.end)
  if (radiusIn <= 0) return null
  const swingDir = opening.swing === 'in' ? jambs.normal : scale(jambs.normal, -1)
  const leafEnd = add(hinge, scale(swingDir, radiusIn))
  const sweep: 0 | 1 = cross(sub(leafEnd, hinge), sub(arcEnd, hinge)) > 0 ? 1 : 0
  return { hinge, leafEnd, arcEnd, radiusIn, sweep }
}

/**
 * Conventional window glazing symbol (spec S5): two lines parallel to the wall
 * across the opening span, inset symmetrically within the wall thickness.
 */
export function windowSymbol(wall: Wall, opening: Opening): { a: Point; b: Point }[] | null {
  const jambs = openingJambs(wall, opening)
  if (!jambs) return null
  const [leftOffset, rightOffset] = wallFaceOffsets(wall.reference, wall.thickness_in)
  const centreOffset = (leftOffset + rightOffset) / 2
  const inset = wall.thickness_in / 4
  return [centreOffset + inset, centreOffset - inset].map((offset) => ({
    a: add(jambs.start, scale(jambs.normal, offset)),
    b: add(jambs.end, scale(jambs.normal, offset)),
  }))
}

/**
 * Projects a world point onto the nearest wall reference line within
 * `maxDistanceIn` — the shared placement/slide resolution for openings
 * (spec S4/S5, §4.2). Restrict `walls` to the host wall to slide along it.
 */
export function projectOntoWalls(
  point: Point,
  walls: readonly Wall[],
  maxDistanceIn: number,
): WallPlacement | null {
  let best: WallPlacement | null = null
  for (const wall of walls) {
    const ring = wall.closed ? [...wall.vertices, wall.vertices[0]] : wall.vertices
    const projected = projectPointOnPolyline(point, ring)
    if (!projected || projected.distance > maxDistanceIn) continue
    if (best && projected.distance >= best.distanceIn) continue
    const segmentLength = distance(ring[projected.segmentIndex], ring[projected.segmentIndex + 1])
    best = {
      wallId: wall.id,
      segmentIndex: projected.segmentIndex,
      tIn: projected.t * segmentLength,
      point: projected.point,
      distanceIn: projected.distance,
    }
  }
  return best
}
