import { describe, expect, it } from 'vitest'

import { PICTOGRAM_CENTER, pictogramBaselineY } from '@/devices/pictograms'
import type { Point } from '@/types/plan'
import {
  deviceGlyphBox,
  deviceScreenScale,
  deviceWallGaps,
  deviceWorldPlacement,
  projectDeviceOntoWalls,
} from '@/utils/geometry'
import type { DevicePlacement } from '@/utils/geometry'
import { makeDevice, makeWall } from '../../helpers/planFactory'

/** Centroid of a polygon's corners — equals the box centre for the nominal box. */
function centroid(points: { x: number; y: number }[]): { x: number; y: number } {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

/**
 * World point a renderer's glyph transform sends symbol-local `point` to at
 * counter-scale `glyphScale`, mirroring the composition rule both
 * `DevicesLayer.vue` and `svgExport.ts` apply:
 * `translate(glyphAnchor) rotate(angleDeg) scale(glyphScale) translate(0 -glyphOffsetIn)`.
 */
function applyGlyphTransform(placement: DevicePlacement, point: Point, glyphScale: number): Point {
  const shifted: Point = { x: point.x, y: point.y - placement.glyphOffsetIn }
  const scaled: Point = { x: shifted.x * glyphScale, y: shifted.y * glyphScale }
  const angleRad = (placement.angleDeg * Math.PI) / 180
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  const rotated: Point = { x: scaled.x * cos - scaled.y * sin, y: scaled.x * sin + scaled.y * cos }
  return { x: placement.glyphAnchor.x + rotated.x, y: placement.glyphAnchor.y + rotated.y }
}

describe('deviceWorldPlacement', () => {
  const diagonalWall = makeWall({
    id: 'wall-1',
    vertices: [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ],
    thickness_in: 4,
  })

  it('places a left-face device on the near face of a 45-degree wall, upright', () => {
    const device = makeDevice({
      attachment: { wall_id: 'wall-1', segment_index: 0, t: 50 * Math.SQRT2, side: 'left' },
    })
    const placement = deviceWorldPlacement(device, [diagonalWall])

    expect(placement).not.toBeNull()
    // Reference point (50, 50) offset by +2 along perpendicular (0.7071, -0.7071)
    // — the bare face point, before any pictogram baseline shift bakes into `position`.
    expect(placement?.glyphAnchor.x).toBeCloseTo(50 + Math.SQRT2, 9)
    expect(placement?.glyphAnchor.y).toBeCloseTo(50 - Math.SQRT2, 9)
    expect(placement?.angleDeg).toBeCloseTo(45, 9)
    expect(placement?.side).toBe('left')
    // `bounds` stays centred on `position` (the default outlet's own baseline shift included).
    const c = centroid(placement?.bounds ?? [])
    expect(c.x).toBeCloseTo(placement?.position.x ?? NaN, 9)
    expect(c.y).toBeCloseTo(placement?.position.y ?? NaN, 9)
  })

  it('flips a right-face device to the far face and rotates it 180 degrees', () => {
    const device = makeDevice({
      attachment: { wall_id: 'wall-1', segment_index: 0, t: 50 * Math.SQRT2, side: 'right' },
    })
    const placement = deviceWorldPlacement(device, [diagonalWall])

    // The bare face point, before any pictogram baseline shift bakes into `position`.
    expect(placement?.glyphAnchor.x).toBeCloseTo(50 - Math.SQRT2, 9)
    expect(placement?.glyphAnchor.y).toBeCloseTo(50 + Math.SQRT2, 9)
    expect(placement?.angleDeg).toBeCloseTo(225, 9)
  })

  it('derives a baseboard rectangle spanning length_in centred at t on the face', () => {
    const wall = makeWall({ thickness_in: 4 })
    const device = makeDevice({
      type: 'baseboard_heater',
      attachment: { wall_id: 'wall-1', segment_index: 0, t: 60, side: 'left' },
      length_in: 36,
    })
    const placement = deviceWorldPlacement(device, [wall])

    // Left face at y = -2; the rect protrudes 3" into the room (further -y).
    expect(placement?.footprintRect).toEqual([
      { x: 42, y: -2 },
      { x: 78, y: -2 },
      { x: 78, y: -5 },
      { x: 42, y: -5 },
    ])
    expect(placement?.bounds).toEqual(placement?.footprintRect)
    // The anchor itself stays ON the face — footprint devices never take the
    // pictogram baseline shift, since their rect is already correctly anchored.
    expect(placement?.position).toEqual({ x: 60, y: -2 })
    // The inscribed glyph sits at the rectangle's centre, half the depth in,
    // with a zero offset — a footprint device's glyph never shifts further.
    expect(placement?.glyphAnchor).toEqual({ x: 60, y: -3.5 })
    expect(placement?.glyphOffsetIn).toBe(0)
  })

  it('resolves an omitted baseboard length to the catalog footprint, unchanged geometry', () => {
    const wall = makeWall({ thickness_in: 4 })
    const attachment = { wall_id: 'wall-1', segment_index: 0, t: 60, side: 'left' as const }
    const fromCatalog = deviceWorldPlacement(
      makeDevice({ type: 'baseboard_heater', attachment, length_in: null, depth_in: null }),
      [wall],
    )
    const fromOverrides = deviceWorldPlacement(
      makeDevice({ type: 'baseboard_heater', attachment, length_in: 36, depth_in: 3 }),
      [wall],
    )

    expect(fromCatalog?.footprintRect).toEqual(fromOverrides?.footprintRect)
  })

  it('lets a per-device override beat the catalog footprint', () => {
    const wall = makeWall({ thickness_in: 4 })
    const device = makeDevice({
      type: 'baseboard_heater',
      attachment: { wall_id: 'wall-1', segment_index: 0, t: 60, side: 'left' },
      length_in: 48,
      depth_in: 5,
    })
    const placement = deviceWorldPlacement(device, [wall])

    expect(placement?.footprintRect).toEqual([
      { x: 36, y: -2 },
      { x: 84, y: -2 },
      { x: 84, y: -7 },
      { x: 36, y: -7 },
    ])
  })

  it('gives a positioned water heater a true-size 22x22 rectangle centred on its position', () => {
    const device = makeDevice({
      type: 'water_heater',
      attachment: null,
      position: { x: 100, y: 50 },
    })
    const placement = deviceWorldPlacement(device, [])

    expect(placement?.footprintRect).toEqual([
      { x: 89, y: 39 },
      { x: 111, y: 39 },
      { x: 111, y: 61 },
      { x: 89, y: 61 },
    ])
    expect(placement?.bounds).toEqual(placement?.footprintRect)
    // A positioned footprint device draws its glyph on the rectangle's centre.
    expect(placement?.glyphAnchor).toEqual({ x: 100, y: 50 })
    expect(placement?.glyphOffsetIn).toBe(0)
  })

  it('leaves a symbolic type (switch) on the nominal box with no footprint rectangle', () => {
    const wall = makeWall({ thickness_in: 3.5 })
    const device = makeDevice({
      type: 'switch',
      attachment: { wall_id: 'wall-1', segment_index: 0, t: 60, side: 'left' },
    })
    const placement = deviceWorldPlacement(device, [wall])
    if (!placement) throw new Error('expected a placement')

    expect(placement.footprintRect).toBeNull()
    // At scale 1 the glyph composition (anchor shifted by the offset, along
    // the placement's own local axis) rebuilds the very same box centre as
    // `position` — see `glyphAnchor`.
    expect(centroid(deviceGlyphBox(placement))).toEqual(placement.position)
    expect(placement.bounds).toHaveLength(4)
    // The nominal 12" box, not a real size.
    const box = placement.bounds
    expect(Math.max(...box.map((p) => p.x)) - Math.min(...box.map((p) => p.x))).toBeCloseTo(12, 9)
  })

  it("shifts a switch's anchor outward from the face by its pictogram baseline, at scale 1 AND every zoom", () => {
    const wall = makeWall({ thickness_in: 3.5 })
    const device = makeDevice({
      type: 'switch',
      attachment: { wall_id: 'wall-1', segment_index: 0, t: 60, side: 'left' },
    })
    const placement = deviceWorldPlacement(device, [wall])
    if (!placement) throw new Error('expected a placement')

    // Left face at y = -1.75. The switch's stem tip (local y 11.5) is the
    // baseline, so the box centre lands 11.5 - 6 = 5.5" further outward
    // (up-screen, toward the room) than the bare face anchor.
    expect(placement.position).toEqual({ x: 60, y: -7.25 })
    const c = centroid(placement.bounds)
    expect(c.x).toBeCloseTo(60, 9)
    expect(c.y).toBeCloseTo(-7.25, 9)

    // The glyph anchor is the BARE face point (unlike `position`), and the
    // offset carries the whole baseline shift.
    expect(placement.glyphAnchor).toEqual({ x: 60, y: -1.75 })
    expect(placement.glyphOffsetIn).toBeCloseTo(pictogramBaselineY('switch') - PICTOGRAM_CENTER, 9)

    // The stem tip (local y = the baseline, i.e. `glyphOffsetIn` above the box
    // centre) lands exactly on the face at scale 1 AND at the D4 zoomed-out
    // clamp (ppi 0.5, s ≈ 2.33) alike — the fix for the bug where the offset
    // sat OUTSIDE the D4 scale and the stem sank ~7.3" into the wall as s grew.
    for (const glyphScale of [1, deviceScreenScale(0.5)]) {
      const stemTip = applyGlyphTransform(
        placement,
        { x: 0, y: placement.glyphOffsetIn },
        glyphScale,
      )
      expect(stemTip.x).toBeCloseTo(placement.glyphAnchor.x, 9)
      expect(stemTip.y).toBeCloseTo(placement.glyphAnchor.y, 9)
    }
  })

  it('shifts an outlet fully into the room, its circle tangent to the face (bug fix: it used to reach into the wall)', () => {
    const wall = makeWall({ thickness_in: 3.5 })
    const device = makeDevice({
      type: 'outlet',
      attachment: { wall_id: 'wall-1', segment_index: 0, t: 60, side: 'left' },
    })
    const placement = deviceWorldPlacement(device, [wall])
    if (!placement) throw new Error('expected a placement')

    // Left face at y = -1.75. The outlet's circle reaches local y = 9.6 (its
    // derived baseline, r 3.6 past the box centre) — 3.6" past the box centre,
    // so the box centre lands 3.6" further outward than the bare face anchor.
    expect(placement.glyphAnchor).toEqual({ x: 60, y: -1.75 })
    expect(placement.glyphOffsetIn).toBeCloseTo(3.6, 9)
    expect(placement.position).toEqual({ x: 60, y: -5.35 })

    // The circle's wall-facing edge (local y = 9.6, i.e. `glyphOffsetIn` above
    // the box centre) touches the face exactly — at scale 1 and at the D4
    // zoomed-out clamp alike — instead of half the circle sitting inside the
    // wall as it did before the fix.
    for (const glyphScale of [1, deviceScreenScale(0.5)]) {
      const faceTouch = applyGlyphTransform(
        placement,
        { x: 0, y: placement.glyphOffsetIn },
        glyphScale,
      )
      expect(faceTouch.x).toBeCloseTo(placement.glyphAnchor.x, 9)
      expect(faceTouch.y).toBeCloseTo(placement.glyphAnchor.y, 9)
    }
  })

  it('positions a free device at its absolute position with its own rotation', () => {
    const device = makeDevice({
      type: 'ceiling_light',
      attachment: null,
      position: { x: 30, y: 40 },
      rotation_deg: 90,
    })
    const placement = deviceWorldPlacement(device, [])

    expect(placement?.position).toEqual({ x: 30, y: 40 })
    expect(placement?.angleDeg).toBe(90)
    expect(placement?.side).toBeNull()
  })

  it('returns null when the host wall is missing', () => {
    const device = makeDevice({
      attachment: { wall_id: 'ghost', segment_index: 0, t: 10, side: 'left' },
    })
    expect(deviceWorldPlacement(device, [])).toBeNull()
  })
})

describe('deviceScreenScale', () => {
  it('does not shrink devices below the minimum screen size', () => {
    // Nominal 12" box is 24 px at 2 px/in — already above the 14 px floor.
    expect(deviceScreenScale(2)).toBe(1)
    // At 0.5 px/in the box is 6 px; scale up to reach 14 px.
    expect(deviceScreenScale(0.5)).toBeCloseTo(14 / 6, 9)
  })
})

describe('deviceGlyphBox', () => {
  it('is the nominal box around the glyph, independent of the true-size footprint (spec D4)', () => {
    const placement = deviceWorldPlacement(
      makeDevice({ type: 'water_heater', attachment: null, position: { x: 0, y: 0 } }),
      [],
    )
    if (!placement) throw new Error('expected a placement')

    // The 22x22 rectangle is real geometry; the inscribed glyph keeps the
    // nominal 12" box it is clamped against, centred on the same point.
    expect(deviceGlyphBox(placement)).toEqual([
      { x: -6, y: -6 },
      { x: 6, y: -6 },
      { x: 6, y: 6 },
      { x: -6, y: 6 },
    ])
  })
})

describe('projectDeviceOntoWalls', () => {
  const wall = makeWall({ id: 'wall-1' })

  it('picks the left face when the cursor is on the left of the segment travel', () => {
    const hit = projectDeviceOntoWalls({ x: 60, y: -5 }, [wall], 20)
    expect(hit).toEqual({ wallId: 'wall-1', segmentIndex: 0, tIn: 60, side: 'left' })
  })

  it('picks the right face when the cursor is on the right of the segment travel', () => {
    const hit = projectDeviceOntoWalls({ x: 60, y: 5 }, [wall], 20)
    expect(hit?.side).toBe('right')
  })

  it('returns null beyond the capture radius', () => {
    expect(projectDeviceOntoWalls({ x: 60, y: 50 }, [wall], 20)).toBeNull()
  })
})

describe('deviceWallGaps', () => {
  it('measures face-to-face along the host wall to the two crossing partitions', () => {
    const host = makeWall({
      id: 'host',
      vertices: [
        { x: 0, y: 0 },
        { x: 240, y: 0 },
      ],
      thickness_in: 4,
    })
    const partitionA = makeWall({
      id: 'part-a',
      vertices: [
        { x: 48, y: -50 },
        { x: 48, y: 50 },
      ],
      thickness_in: 4,
    })
    const partitionB = makeWall({
      id: 'part-b',
      vertices: [
        { x: 180, y: -50 },
        { x: 180, y: 50 },
      ],
      thickness_in: 6,
    })

    const gaps = deviceWallGaps(host, 0, 120, 'left', [host, partitionA, partitionB])

    // Partition A near (right) face at x=50 → 70" to the left; partition B near
    // (left) face at x=177 → 57" to the right.
    expect(gaps.left?.distanceIn).toBeCloseTo(70, 9)
    expect(gaps.left?.featureT).toBeCloseTo(50, 9)
    expect(gaps.right?.distanceIn).toBeCloseTo(57, 9)
    expect(gaps.right?.featureT).toBeCloseTo(177, 9)
    // Chip anchors ride the device's left face at y = -2.
    expect(gaps.left?.from).toEqual({ x: 120, y: -2 })
    expect(gaps.left?.to).toEqual({ x: 50, y: -2 })
  })

  it('falls back to the segment end corners when no wall crosses', () => {
    const host = makeWall({
      id: 'host',
      vertices: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
      ],
    })
    const gaps = deviceWallGaps(host, 0, 40, 'left', [host])

    expect(gaps.left?.featureT).toBe(0)
    expect(gaps.left?.distanceIn).toBe(40)
    expect(gaps.right?.featureT).toBe(120)
    expect(gaps.right?.distanceIn).toBe(80)
  })
})
