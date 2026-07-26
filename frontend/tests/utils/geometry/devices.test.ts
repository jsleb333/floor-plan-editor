import { describe, expect, it } from 'vitest'

import {
  deviceGlyphBox,
  deviceScreenScale,
  deviceWallGaps,
  deviceWorldPlacement,
  projectDeviceOntoWalls,
} from '@/utils/geometry'
import { makeDevice, makeWall } from '../../helpers/planFactory'

/** Centroid of a polygon's corners — equals the box centre for the nominal box. */
function centroid(points: { x: number; y: number }[]): { x: number; y: number } {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 })
  return { x: sum.x / points.length, y: sum.y / points.length }
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
    // Reference point (50, 50) offset by +2 along perpendicular (0.7071, -0.7071).
    expect(placement?.position.x).toBeCloseTo(50 + Math.SQRT2, 9)
    expect(placement?.position.y).toBeCloseTo(50 - Math.SQRT2, 9)
    expect(placement?.angleDeg).toBeCloseTo(45, 9)
    expect(placement?.side).toBe('left')
    const c = centroid(placement?.bounds ?? [])
    expect(c.x).toBeCloseTo(50 + Math.SQRT2, 9)
    expect(c.y).toBeCloseTo(50 - Math.SQRT2, 9)
  })

  it('flips a right-face device to the far face and rotates it 180 degrees', () => {
    const device = makeDevice({
      attachment: { wall_id: 'wall-1', segment_index: 0, t: 50 * Math.SQRT2, side: 'right' },
    })
    const placement = deviceWorldPlacement(device, [diagonalWall])

    expect(placement?.position.x).toBeCloseTo(50 - Math.SQRT2, 9)
    expect(placement?.position.y).toBeCloseTo(50 + Math.SQRT2, 9)
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
    // The inscribed glyph sits at the rectangle's centre, half the depth in.
    expect(placement?.glyphPosition).toEqual({ x: 60, y: -3.5 })
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
    expect(placement?.glyphPosition).toEqual({ x: 100, y: 50 })
  })

  it('leaves a symbolic type (switch) on the nominal box with no footprint rectangle', () => {
    const wall = makeWall({ thickness_in: 3.5 })
    const device = makeDevice({
      type: 'switch',
      attachment: { wall_id: 'wall-1', segment_index: 0, t: 60, side: 'left' },
    })
    const placement = deviceWorldPlacement(device, [wall])

    expect(placement?.footprintRect).toBeNull()
    expect(placement?.glyphPosition).toEqual(placement?.position)
    expect(placement?.bounds).toHaveLength(4)
    // The nominal 12" box, not a real size.
    const box = placement?.bounds ?? []
    expect(Math.max(...box.map((p) => p.x)) - Math.min(...box.map((p) => p.x))).toBeCloseTo(12, 9)
  })

  it("shifts a switch's anchor outward from the face by its pictogram baseline", () => {
    const wall = makeWall({ thickness_in: 3.5 })
    const device = makeDevice({
      type: 'switch',
      attachment: { wall_id: 'wall-1', segment_index: 0, t: 60, side: 'left' },
    })
    const placement = deviceWorldPlacement(device, [wall])

    // Left face at y = -1.75. The switch's stem tip (local y 11.5) is the
    // baseline, so the box centre lands 11.5 - 6 = 5.5" further outward
    // (up-screen, toward the room) than the bare face anchor.
    expect(placement?.position).toEqual({ x: 60, y: -7.25 })
    const c = centroid(placement?.bounds ?? [])
    expect(c.x).toBeCloseTo(60, 9)
    expect(c.y).toBeCloseTo(-7.25, 9)
  })

  it('leaves a face-centred pictogram (outlet) unshifted', () => {
    const wall = makeWall({ thickness_in: 3.5 })
    const device = makeDevice({
      type: 'outlet',
      attachment: { wall_id: 'wall-1', segment_index: 0, t: 60, side: 'left' },
    })
    const placement = deviceWorldPlacement(device, [wall])

    expect(placement?.position).toEqual({ x: 60, y: -1.75 })
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
