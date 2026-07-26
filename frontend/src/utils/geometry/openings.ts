import type { DoorStyle, Opening, Point, Wall } from '@/types/plan'

import { projectPointOnPolyline } from './lines'
import { add, cross, distance, lerp, normalize, perpendicular, scale, sub } from './vec'
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

/** A quarter-circle arc closing a door stroke, swept from its last point to `to`. */
export interface DoorArc {
  to: Point
  radiusIn: number
  /** SVG sweep flag for the arc, around the stroke's first point. */
  sweep: 0 | 1
}

/**
 * One continuous stroke of a door symbol: a polyline of leaf/panel segments,
 * optionally closed by a swing arc from its last point.
 */
export interface DoorStroke {
  /** Two or more points; consecutive points are straight segments. */
  points: Point[]
  /** Quarter arc from the last point, or null when the stroke is straight only. */
  arc: DoorArc | null
  /** Drawn dashed — the pocket cavity hidden inside the wall; solid otherwise. */
  dashed: boolean
}

/** Everything drawn for a door, whatever its style (spec S4). */
export interface DoorFigure {
  style: DoorStyle
  strokes: DoorStroke[]
}

/** Dash pattern, in world inches, of a door figure's dashed strokes. */
export const DOOR_DASH_IN: readonly [number, number] = [3, 2]

/** The two jamb points of an opening plus the host segment's frame. */
export interface OpeningJambs {
  start: Point
  end: Point
  /** Unit vector along the segment's travel direction. */
  unit: Point
  /** Unit normal toward the left of travel. */
  normal: Point
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
export function openingJambs(wall: Wall, opening: Opening): OpeningJambs | null {
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

/** Signed offset of the wall's mid-thickness line from its reference line. */
function wallCentreOffsetIn(wall: Wall): number {
  const [leftOffset, rightOffset] = wallFaceOffsets(wall.reference, wall.thickness_in)
  return (leftOffset + rightOffset) / 2
}

/** Everything the per-style door builders derive from the host wall, computed once. */
interface DoorFrame {
  jambs: OpeningJambs
  /** Opening width actually drawn, i.e. the jamb-to-jamb distance. */
  widthIn: number
  /** Midpoint of the opening span, on the reference line. */
  mid: Point
  /** Unit normal pointing to the `swing` side of the wall ('in' = left of travel). */
  swingDir: Point
  /** Signed offset of the wall's mid-thickness line from the reference line. */
  centreOffsetIn: number
  /** Reference line left beyond each jamb, within the host segment. */
  clearanceIn: { start: number; end: number }
}

/** Moves `point` across the wall by `offsetIn` (positive = toward the left of travel). */
function across(point: Point, jambs: OpeningJambs, offsetIn: number): Point {
  return add(point, scale(jambs.normal, offsetIn))
}

/** A straight, solid stroke through `points`. */
function panelStroke(points: Point[]): DoorStroke {
  return { points, arc: null, dashed: false }
}

/**
 * One swinging leaf: hinged at `hinge`, swung `radiusIn` toward `swingDir`, then
 * arced back to `arcEnd`. The sweep flag is the side `arcEnd` falls on.
 */
function leafStroke(hinge: Point, arcEnd: Point, swingDir: Point, radiusIn: number): DoorStroke {
  const leafEnd = add(hinge, scale(swingDir, radiusIn))
  const sweep: 0 | 1 = cross(sub(leafEnd, hinge), sub(arcEnd, hinge)) > 0 ? 1 : 0
  return { points: [hinge, leafEnd], arc: { to: arcEnd, radiusIn, sweep }, dashed: false }
}

/**
 * Single hinged leaf plus its quarter arc to the far jamb, straight from
 * `doorSymbol` so the plain swing door draws exactly as it always has.
 */
function swingStrokes(wall: Wall, opening: Opening): DoorStroke[] {
  const symbol = doorSymbol(wall, opening)
  if (!symbol) return []
  return [
    {
      points: [symbol.hinge, symbol.leafEnd],
      arc: { to: symbol.arcEnd, radiusIn: symbol.radiusIn, sweep: symbol.sweep },
      dashed: false,
    },
  ]
}

/** Two half-width leaves hinged at opposite jambs, both swinging to the `swing` side. */
function doubleStrokes(frame: DoorFrame): DoorStroke[] {
  const radiusIn = frame.widthIn / 2
  return [
    leafStroke(frame.jambs.start, frame.mid, frame.swingDir, radiusIn),
    leafStroke(frame.jambs.end, frame.mid, frame.swingDir, radiusIn),
  ]
}

/**
 * Two bypassing panels parallel to the wall, one per half of the opening, held a
 * quarter of the thickness off the mid-thickness line on opposite faces so the
 * bypass reads. `hinge` picks which half sits on which face.
 */
function slidingStrokes(wall: Wall, opening: Opening, frame: DoorFrame): DoorStroke[] {
  const inset = wall.thickness_in / 4
  const towardLeftFace = opening.hinge === 'left'
  const startOffset = frame.centreOffsetIn + (towardLeftFace ? inset : -inset)
  const endOffset = frame.centreOffsetIn + (towardLeftFace ? -inset : inset)
  const { jambs, mid } = frame
  return [
    panelStroke([across(jambs.start, jambs, startOffset), across(mid, jambs, startOffset)]),
    panelStroke([across(mid, jambs, endOffset), across(jambs.end, jambs, endOffset)]),
  ]
}

/**
 * A folded pair of leaves: two equal segments from the stacking jamb (`hinge`)
 * to the opening midpoint, peaking a quarter of the width into the `swing` side
 * — the shallow V that reads as a bifold at any scale.
 */
function bifoldStrokes(opening: Opening, frame: DoorFrame): DoorStroke[] {
  const stack = opening.hinge === 'left' ? frame.jambs.start : frame.jambs.end
  const fold = add(lerp(stack, frame.mid, 0.5), scale(frame.swingDir, frame.widthIn / 4))
  return [panelStroke([stack, fold, frame.mid])]
}

/**
 * One leaf on the wall's mid-thickness line, filling the opening, plus a dashed
 * stroke for the cavity it slides into beyond the `hinge` jamb — never longer
 * than the reference line left on that side of the segment.
 */
function pocketStrokes(opening: Opening, frame: DoorFrame): DoorStroke[] {
  const { jambs, centreOffsetIn } = frame
  const leafStart = across(jambs.start, jambs, centreOffsetIn)
  const leafEnd = across(jambs.end, jambs, centreOffsetIn)
  const strokes = [panelStroke([leafStart, leafEnd])]
  const pocketAtStart = opening.hinge === 'left'
  const clearance = pocketAtStart ? frame.clearanceIn.start : frame.clearanceIn.end
  const cavityIn = Math.min(frame.widthIn, clearance)
  if (cavityIn > 0) {
    const mouth = pocketAtStart ? leafStart : leafEnd
    const into = scale(jambs.unit, pocketAtStart ? -cavityIn : cavityIn)
    strokes.push({ points: [mouth, add(mouth, into)], arc: null, dashed: true })
  }
  return strokes
}

/**
 * Every stroke of a door's symbol, dispatched on its `style` (spec S4). All five
 * styles are DERIVED from the host wall's current reference line and drawn per
 * architectural convention:
 *
 * - `swing`: one leaf hinged at the `hinge` jamb plus a quarter arc to the far
 *   jamb, swung toward the `swing` side — the `doorSymbol` geometry, unchanged.
 * - `double`: two half-width leaves hinged at OPPOSITE jambs, each arcing to the
 *   opening midpoint, both swinging to the `swing` side (`hinge` is unused).
 * - `sliding`: two bypassing panels parallel to the wall, one per half of the
 *   opening, on opposite faces within the thickness (`hinge` picks the halves'
 *   faces, i.e. which way it slides open; `swing` is unused).
 * - `bifold`: a shallow V of two equal leaves from the `hinge` jamb (the stack
 *   side) to the opening midpoint, folding into the `swing` side.
 * - `pocket`: the leaf inside the wall band on its mid-thickness line, plus a
 *   dashed cavity beyond the `hinge` jamb (`swing` is unused).
 *
 * Returns null for a degenerate host segment, like every other opening helper.
 */
export function doorFigure(wall: Wall, opening: Opening): DoorFigure | null {
  const span = wallSegmentSpan(wall, opening.segment_index)
  const jambs = openingJambs(wall, opening)
  if (!span || !jambs) return null
  const widthIn = distance(jambs.start, jambs.end)
  if (widthIn <= 0) return null
  const centre = clampOpeningT(opening.t, opening.width_in, span.lengthIn)
  const frame: DoorFrame = {
    jambs,
    widthIn,
    mid: lerp(jambs.start, jambs.end, 0.5),
    swingDir: opening.swing === 'in' ? jambs.normal : scale(jambs.normal, -1),
    centreOffsetIn: wallCentreOffsetIn(wall),
    clearanceIn: {
      start: centre - widthIn / 2,
      end: span.lengthIn - (centre + widthIn / 2),
    },
  }
  const style: DoorStyle = opening.style ?? 'swing'
  switch (style) {
    case 'swing':
      return { style, strokes: swingStrokes(wall, opening) }
    case 'double':
      return { style, strokes: doubleStrokes(frame) }
    case 'sliding':
      return { style, strokes: slidingStrokes(wall, opening, frame) }
    case 'bifold':
      return { style, strokes: bifoldStrokes(opening, frame) }
    case 'pocket':
      return { style, strokes: pocketStrokes(opening, frame) }
  }
}

/**
 * Conventional window glazing symbol (spec S5): two lines parallel to the wall
 * across the opening span, inset symmetrically within the wall thickness.
 */
export function windowSymbol(wall: Wall, opening: Opening): { a: Point; b: Point }[] | null {
  const jambs = openingJambs(wall, opening)
  if (!jambs) return null
  const centreOffset = wallCentreOffsetIn(wall)
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
