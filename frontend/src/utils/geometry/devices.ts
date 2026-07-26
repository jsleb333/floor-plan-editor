import { effectiveDeviceFootprint } from '@/devices/catalog'
import { PICTOGRAM_CENTER, pictogramBaselineY } from '@/devices/pictograms'
import type { Device, Point, Wall } from '@/types/plan'

import { lineIntersection } from './lines'
import { add, angleOf, distance, dot, normalize, perpendicular, scale, sub } from './vec'
import { wallSegmentSpan } from './openings'
import { wallFaceOffsets } from './wallOutline'

/**
 * Derived world placement of a device (spec §4.2): its symbol anchor, the
 * angle its pictogram is drawn at (degrees, SVG clockwise) and the hit polygon.
 * Everything here is recomputed from the host wall's current geometry — never
 * persisted.
 */

/** Nominal pictogram box side in world inches; symbols draw within [-6, 6]². */
export const DEVICE_NOMINAL_IN = 12
/** Default screen size (px) a device never shrinks below (spec D4). */
export const DEVICE_MIN_SCREEN_PX = 14

/** A device's world placement, plus its true-size footprint rectangle when it has one. */
export interface DevicePlacement {
  /** Wire/attachment anchor: on the host face for attached devices, else `position`. */
  position: Point
  /** Pictogram rotation in degrees (SVG clockwise from +x). */
  angleDeg: number
  /** Host face for attached devices, else `null`. */
  side: 'left' | 'right' | null
  /** Hit polygon: the nominal box for symbols, the footprint rectangle otherwise. */
  bounds: Point[]
  /** Oriented true-size rectangle corners for a footprint device, else `null`. */
  footprintRect: Point[] | null
  /** Where the pictogram glyph draws: the rectangle's centre, else `position`. */
  glyphPosition: Point
}

/** Below this the two segment directions count as parallel (no crossing). */
const CROSS_PARALLEL_TOLERANCE = 1e-6
/** Parameter tolerance for a real crossing to lie within both segments. */
const CROSS_EXTENT_TOLERANCE = 1e-6

/**
 * One live temporary-dimension chip for device placement/slide (spec S2a):
 * the along-wall face-to-face distance from the device to the nearest feature
 * on one side of the host segment.
 */
export interface DeviceGap {
  /** Along the host segment: 'left' toward the segment start, 'right' toward its end. */
  side: 'left' | 'right'
  /** Face-to-face distance in inches from the device to the feature. */
  distanceIn: number
  /** The feature's position along the host segment reference line, in inches. */
  featureT: number
  /** Chip anchor at the device, on its host face. */
  from: Point
  /** Chip anchor at the feature, on the device's host face. */
  to: Point
}

/** Nearest feature per side along the host wall; `null` when none exists on a side. */
export interface DeviceGaps {
  left: DeviceGap | null
  right: DeviceGap | null
}

/** Clamps a device's along-segment position to the segment span. */
function clampT(t: number, lengthIn: number): number {
  return Math.max(0, Math.min(t, lengthIn))
}

/** The four corners of a box centred at `centre`, half-extents `hx`/`hy`, in frame `ex`/`ey`. */
function boxCorners(centre: Point, hx: number, hy: number, ex: Point, ey: Point): Point[] {
  return [
    add(centre, add(scale(ex, -hx), scale(ey, -hy))),
    add(centre, add(scale(ex, hx), scale(ey, -hy))),
    add(centre, add(scale(ex, hx), scale(ey, hy))),
    add(centre, add(scale(ex, -hx), scale(ey, hy))),
  ]
}

/**
 * World placement of a device (spec §4.2, D1).
 *
 * Attached devices sit ON the chosen face of the host wall at `t`: the anchor
 * is the reference point offset to that face, and the pictogram is rotated so
 * the wall runs along its local x while its "room" side points away from the
 * wall body (a `right`-side device is flipped 180°). For a SYMBOLIC device
 * (one whose catalog row has no footprint) the anchor is then nudged outward,
 * along the face normal, by the device type's pictogram baseline
 * (`pictogramBaselineY`, spec-drawn per symbol) so the symbol's own baseline
 * ink — not the box centre — touches the face; a type with no baseline
 * recorded is unaffected, and its `bounds` are the nominal box.
 *
 * A FOOTPRINT device (spec D2 — one with a real size, e.g. a baseboard heater
 * or a water heater) instead resolves to an oriented rectangle at TRUE world
 * size, which is both its `footprintRect` and its `bounds`. Attached, it keeps
 * the unshifted face anchor and the rectangle spans the effective along-wall
 * length centred at `t`, protruding into the room by the effective depth;
 * positioned, the rectangle centres on `position` and honours `rotation_deg`.
 *
 * D4 interaction: the footprint rectangle is real geometry, so it draws at true
 * size and NEVER takes the minimum-screen-size counter-scale — a 22" water
 * heater is meant to shrink as you zoom out. Only the pictogram glyph inscribed
 * in it stays legible, drawn at `glyphPosition` (the rectangle's centre) under
 * the usual `deviceScreenScale` clamp. Symbolic devices are unaffected: their
 * `glyphPosition` is just `position`.
 *
 * Returns `null` when the host wall or segment is missing.
 *
 * @param device The device to place.
 * @param walls The document walls, to resolve an attachment's host.
 */
export function deviceWorldPlacement(
  device: Device,
  walls: readonly Wall[],
): DevicePlacement | null {
  const footprint = effectiveDeviceFootprint(device)
  if (device.attachment) {
    const wall = walls.find((candidate) => candidate.id === device.attachment?.wall_id)
    if (!wall) return null
    const span = wallSegmentSpan(wall, device.attachment.segment_index)
    if (!span || span.lengthIn <= 0) return null
    const u = normalize(sub(span.b, span.a))
    const perp = perpendicular(u)
    const side = device.attachment.side
    const [leftOffset, rightOffset] = wallFaceOffsets(wall.reference, wall.thickness_in)
    const faceOffset = side === 'left' ? leftOffset : rightOffset
    const t = clampT(device.attachment.t, span.lengthIn)
    const basePoint = add(span.a, scale(u, t))
    const position = add(basePoint, scale(perp, faceOffset))
    // Outward normal points into the room (beyond the near face).
    const outward = side === 'left' ? perp : scale(perp, -1)
    const angleRad = angleOf(u) + (side === 'right' ? Math.PI : 0)
    const angleDeg = (angleRad * 180) / Math.PI

    if (footprint) {
      const half = footprint.along_in / 2
      const lo = clampT(t - half, span.lengthIn)
      const hi = clampT(t + half, span.lengthIn)
      const faceLo = add(add(span.a, scale(u, lo)), scale(perp, faceOffset))
      const faceHi = add(add(span.a, scale(u, hi)), scale(perp, faceOffset))
      const depth = scale(outward, footprint.across_in)
      const rect = [faceLo, faceHi, add(faceHi, depth), add(faceLo, depth)]
      return {
        position,
        angleDeg,
        side,
        bounds: rect,
        footprintRect: rect,
        glyphPosition: add(position, scale(outward, footprint.across_in / 2)),
      }
    }

    const ex = u
    const ey = scale(outward, -1)
    const faceOffsetIn = pictogramBaselineY(device.type) - PICTOGRAM_CENTER
    const symbolPosition = add(position, scale(outward, faceOffsetIn))
    return {
      position: symbolPosition,
      angleDeg,
      side,
      bounds: boxCorners(symbolPosition, DEVICE_NOMINAL_IN / 2, DEVICE_NOMINAL_IN / 2, ex, ey),
      footprintRect: null,
      glyphPosition: symbolPosition,
    }
  }

  if (!device.position) return null
  const angleRad = (device.rotation_deg * Math.PI) / 180
  const ex = { x: Math.cos(angleRad), y: Math.sin(angleRad) }
  const ey = { x: -Math.sin(angleRad), y: Math.cos(angleRad) }
  const halfX = footprint ? footprint.along_in / 2 : DEVICE_NOMINAL_IN / 2
  const halfY = footprint ? footprint.across_in / 2 : DEVICE_NOMINAL_IN / 2
  const corners = boxCorners(device.position, halfX, halfY, ex, ey)
  return {
    position: { ...device.position },
    angleDeg: device.rotation_deg,
    side: null,
    bounds: corners,
    footprintRect: footprint ? corners : null,
    glyphPosition: { ...device.position },
  }
}

/**
 * Corners of the nominal pictogram box a placement's glyph occupies: the
 * `DEVICE_NOMINAL_IN` square centred on `glyphPosition`, rotated with the
 * placement. Identical to `bounds` for a symbolic device; for a footprint
 * device it is the ink the inscribed glyph adds around its true-size rectangle,
 * which content extents (and therefore the export viewBox) must cover.
 */
export function deviceGlyphBox(placement: DevicePlacement): Point[] {
  const angleRad = (placement.angleDeg * Math.PI) / 180
  const ex = { x: Math.cos(angleRad), y: Math.sin(angleRad) }
  const ey = { x: -Math.sin(angleRad), y: Math.cos(angleRad) }
  const half = DEVICE_NOMINAL_IN / 2
  return boxCorners(placement.glyphPosition, half, half, ex, ey)
}

/**
 * Counter-scale that keeps a device pictogram legible at any zoom (spec D4):
 * `1` when the nominal box is already at least `minScreenPx` on screen, else
 * the factor that grows it (in world units) up to `minScreenPx`.
 *
 * @param pixelsPerInch Current screen pixels per world inch.
 * @param minScreenPx Minimum on-screen box size (defaults to the D4 clamp).
 */
export function deviceScreenScale(
  pixelsPerInch: number,
  minScreenPx: number = DEVICE_MIN_SCREEN_PX,
): number {
  const nominalPx = DEVICE_NOMINAL_IN * Math.max(pixelsPerInch, Number.EPSILON)
  return Math.max(1, minScreenPx / nominalPx)
}

/**
 * Resolves a cursor onto the nearest wall for placing/sliding a wall-mounted
 * device (spec D1): the projected reference-line address plus the FACE side the
 * cursor is on (spec §4.2 `side`). Restrict `walls` to the host to slide.
 *
 * @param cursor World cursor point.
 * @param walls Candidate host walls.
 * @param maxDistanceIn Capture radius in inches.
 */
export function projectDeviceOntoWalls(
  cursor: Point,
  walls: readonly Wall[],
  maxDistanceIn: number,
): { wallId: string; segmentIndex: number; tIn: number; side: 'left' | 'right' } | null {
  let best: {
    wallId: string
    segmentIndex: number
    tIn: number
    side: 'left' | 'right'
    distanceIn: number
  } | null = null
  for (const wall of walls) {
    const segmentCount = wall.closed ? wall.vertices.length : wall.vertices.length - 1
    for (let i = 0; i < segmentCount; i++) {
      const a = wall.vertices[i]
      const b = wall.vertices[(i + 1) % wall.vertices.length]
      const length = distance(a, b)
      if (length <= 0) continue
      const u = normalize(sub(b, a))
      const tRaw = (cursor.x - a.x) * u.x + (cursor.y - a.y) * u.y
      const t = Math.max(0, Math.min(tRaw, length))
      const foot = add(a, scale(u, t))
      const gap = distance(cursor, foot)
      if (gap > maxDistanceIn) continue
      if (best && gap >= best.distanceIn) continue
      // The cursor's side of the segment travel direction picks the host face.
      const cross = (b.x - a.x) * (cursor.y - a.y) - (b.y - a.y) * (cursor.x - a.x)
      const side: 'left' | 'right' = cross < 0 ? 'left' : 'right'
      best = { wallId: wall.id, segmentIndex: i, tIn: t, side, distanceIn: gap }
    }
  }
  if (!best) return null
  return { wallId: best.wallId, segmentIndex: best.segmentIndex, tIn: best.tIn, side: best.side }
}

/**
 * Temporary dimensions for a wall-mounted device along its host segment
 * (spec S2a/D1): the nearest crossing wall's near FACE — or the host segment's
 * own end corner as a fallback — on each side of the device's position `t`,
 * measured face to face. Chip anchors sit on the device's host `side` face.
 *
 * @param host The host wall.
 * @param segmentIndex The host segment the device sits on.
 * @param t The device position in inches along the segment reference line.
 * @param side The host face the device sits on (anchors the chips).
 * @param walls All walls; the host wall is excluded from crossing detection.
 */
export function deviceWallGaps(
  host: Wall,
  segmentIndex: number,
  t: number,
  side: 'left' | 'right',
  walls: readonly Wall[],
): DeviceGaps {
  const span = wallSegmentSpan(host, segmentIndex)
  if (!span || span.lengthIn <= 0) return { left: null, right: null }
  const u = normalize(sub(span.b, span.a))
  const perp = perpendicular(u)
  const [leftOffset, rightOffset] = wallFaceOffsets(host.reference, host.thickness_in)
  const faceOffset = side === 'left' ? leftOffset : rightOffset
  const deviceT = clampT(t, span.lengthIn)

  const anchor = (tc: number): Point => add(add(span.a, scale(u, tc)), scale(perp, faceOffset))

  // Feature candidates as t-coordinates along the host segment: the crossing
  // walls' near faces plus the segment's own end corners.
  const leftFeatures: number[] = [0]
  const rightFeatures: number[] = [span.lengthIn]

  for (const wall of walls) {
    if (wall.id === host.id) continue
    const segmentCount = wall.closed ? wall.vertices.length : wall.vertices.length - 1
    for (let j = 0; j < segmentCount; j++) {
      const va = wall.vertices[j]
      const vb = wall.vertices[(j + 1) % wall.vertices.length]
      const lenC = distance(va, vb)
      if (lenC <= 0) continue
      const uc = normalize(sub(vb, va))
      if (Math.abs(u.x * uc.y - u.y * uc.x) < CROSS_PARALLEL_TOLERANCE) continue
      // A real crossing: reference lines meet within both segments' extents.
      const meet = lineIntersection(span.a, u, va, uc)
      if (!meet) continue
      const th = dot(sub(meet, span.a), u)
      const sc = dot(sub(meet, va), uc)
      if (th < -CROSS_EXTENT_TOLERANCE || th > span.lengthIn + CROSS_EXTENT_TOLERANCE) continue
      if (sc < -CROSS_EXTENT_TOLERANCE || sc > lenC + CROSS_EXTENT_TOLERANCE) continue
      const [faceLeft, faceRight] = wallFaceOffsets(wall.reference, wall.thickness_in)
      const faceTs: number[] = []
      for (const fo of [faceLeft, faceRight]) {
        const faceOrigin = add(va, scale(perpendicular(uc), fo))
        const hit = lineIntersection(span.a, u, faceOrigin, uc)
        if (hit) faceTs.push(dot(sub(hit, span.a), u))
      }
      if (faceTs.length < 2) continue
      const lo = Math.min(...faceTs)
      const hi = Math.max(...faceTs)
      if (hi <= deviceT) leftFeatures.push(hi)
      else if (lo >= deviceT) rightFeatures.push(lo)
    }
  }

  const bestLeft = leftFeatures.reduce((a, b) => (b > a ? b : a), Number.NEGATIVE_INFINITY)
  const bestRight = rightFeatures.reduce((a, b) => (b < a ? b : a), Number.POSITIVE_INFINITY)

  const left: DeviceGap | null = Number.isFinite(bestLeft)
    ? {
        side: 'left',
        distanceIn: deviceT - bestLeft,
        featureT: bestLeft,
        from: anchor(deviceT),
        to: anchor(bestLeft),
      }
    : null
  const right: DeviceGap | null = Number.isFinite(bestRight)
    ? {
        side: 'right',
        distanceIn: bestRight - deviceT,
        featureT: bestRight,
        from: anchor(deviceT),
        to: anchor(bestRight),
      }
    : null
  return { left, right }
}
