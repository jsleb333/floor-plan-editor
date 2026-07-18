import { describe, expect, it } from 'vitest'

import {
  clampOpeningT,
  doorSymbol,
  openingWorldRect,
  projectOntoWalls,
  windowSymbol,
} from '@/utils/geometry'
import { makeOpening, makeWall } from '../../helpers/planFactory'

const SQRT1_2 = Math.SQRT1_2

describe('clampOpeningT', () => {
  it('keeps a fitting opening centre within [width/2, length - width/2]', () => {
    expect(clampOpeningT(60, 32, 120)).toBe(60)
    expect(clampOpeningT(5, 32, 120)).toBe(16)
    expect(clampOpeningT(118, 32, 120)).toBe(104)
  })

  it('centres the opening when the segment is shorter than the opening', () => {
    expect(clampOpeningT(50, 200, 120)).toBe(60)
  })
})

describe('openingWorldRect', () => {
  it('derives exact world corners on a vertical (rotated) wall segment', () => {
    const wall = makeWall({
      vertices: [
        { x: 10, y: 0 },
        { x: 10, y: 200 },
      ],
      thickness_in: 4,
    })
    const opening = makeOpening({ t: 100, width_in: 32 })

    // Travel direction is +y; 'left of travel' is +x in y-down space.
    expect(openingWorldRect(wall, opening)).toEqual([
      { x: 12, y: 84 },
      { x: 12, y: 116 },
      { x: 8, y: 116 },
      { x: 8, y: 84 },
    ])
  })

  it('derives corners on a 45-degree wall segment', () => {
    const wall = makeWall({
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      thickness_in: 4,
    })
    const t = 50 * Math.SQRT2
    const rect = openingWorldRect(wall, makeOpening({ t, width_in: 20 }))

    expect(rect).not.toBeNull()
    const [startLeft, endLeft, endRight, startRight] = rect ?? []
    const along = 10 * SQRT1_2
    const across = 2 * SQRT1_2
    expect(startLeft.x).toBeCloseTo(50 - along + across, 10)
    expect(startLeft.y).toBeCloseTo(50 - along - across, 10)
    expect(endLeft.x).toBeCloseTo(50 + along + across, 10)
    expect(endLeft.y).toBeCloseTo(50 + along - across, 10)
    expect(endRight.x).toBeCloseTo(50 + along - across, 10)
    expect(endRight.y).toBeCloseTo(50 + along + across, 10)
    expect(startRight.x).toBeCloseTo(50 - along - across, 10)
    expect(startRight.y).toBeCloseTo(50 - along + across, 10)
  })

  it('respects the wall reference side when offsetting the faces', () => {
    const wall = makeWall({ thickness_in: 4, reference: 'left' })
    const rect = openingWorldRect(wall, makeOpening({ t: 60, width_in: 32 }))

    // Reference IS the left face: the body grows right of travel (+y here).
    expect(rect).toEqual([
      { x: 44, y: 0 },
      { x: 76, y: 0 },
      { x: 76, y: 4 },
      { x: 44, y: 4 },
    ])
  })

  it('clamps the attachment so the rect stays within the segment', () => {
    const wall = makeWall({ thickness_in: 4 })
    const rect = openingWorldRect(wall, makeOpening({ t: 119, width_in: 32 }))

    expect(rect?.[0]).toEqual({ x: 88, y: -2 })
    expect(rect?.[1]).toEqual({ x: 120, y: -2 })
  })

  it('returns null for an out-of-range segment index', () => {
    expect(openingWorldRect(makeWall(), makeOpening({ segment_index: 5 }))).toBeNull()
  })
})

describe('doorSymbol', () => {
  const wall = makeWall()

  it.each([
    // hinge, swing, expected hinge jamb, leaf tip, opposite jamb, sweep flag
    ['left', 'in', { x: 44, y: 0 }, { x: 44, y: -32 }, { x: 76, y: 0 }, 1],
    ['left', 'out', { x: 44, y: 0 }, { x: 44, y: 32 }, { x: 76, y: 0 }, 0],
    ['right', 'in', { x: 76, y: 0 }, { x: 76, y: -32 }, { x: 44, y: 0 }, 0],
    ['right', 'out', { x: 76, y: 0 }, { x: 76, y: 32 }, { x: 44, y: 0 }, 1],
  ] as const)(
    'hinge %s / swing %s puts the leaf and arc in the right quadrant',
    (hinge, swing, expectedHinge, expectedLeaf, expectedArcEnd, expectedSweep) => {
      const symbol = doorSymbol(wall, makeOpening({ t: 60, width_in: 32, hinge, swing }))

      expect(symbol).not.toBeNull()
      expect(symbol?.hinge).toEqual(expectedHinge)
      expect(symbol?.leafEnd).toEqual(expectedLeaf)
      expect(symbol?.arcEnd).toEqual(expectedArcEnd)
      expect(symbol?.radiusIn).toBe(32)
      expect(symbol?.sweep).toBe(expectedSweep)
    },
  )
})

describe('windowSymbol', () => {
  it('draws two glazing lines inset symmetrically within the wall thickness', () => {
    const wall = makeWall({ thickness_in: 4 })
    const lines = windowSymbol(wall, makeOpening({ kind: 'window', t: 60, width_in: 32 }))

    expect(lines).toEqual([
      { a: { x: 44, y: -1 }, b: { x: 76, y: -1 } },
      { a: { x: 44, y: 1 }, b: { x: 76, y: 1 } },
    ])
  })
})

describe('projectOntoWalls', () => {
  it('projects onto the nearest wall reference line within the threshold', () => {
    const placement = projectOntoWalls({ x: 60, y: 5 }, [makeWall()], 10)

    expect(placement).toEqual({
      wallId: 'wall-1',
      segmentIndex: 0,
      tIn: 60,
      point: { x: 60, y: 0 },
      distanceIn: 5,
    })
  })

  it('returns null beyond the threshold', () => {
    expect(projectOntoWalls({ x: 60, y: 50 }, [makeWall()], 10)).toBeNull()
  })

  it('resolves the segment index on a multi-segment wall', () => {
    const wall = makeWall({
      vertices: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: 120 },
      ],
    })
    const placement = projectOntoWalls({ x: 118, y: 60 }, [wall], 10)

    expect(placement?.segmentIndex).toBe(1)
    expect(placement?.tIn).toBe(60)
  })

  it('includes the closing segment of a closed loop', () => {
    const wall = makeWall({
      closed: true,
      vertices: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: 120 },
        { x: 0, y: 120 },
      ],
    })
    const placement = projectOntoWalls({ x: 2, y: 60 }, [wall], 10)

    expect(placement?.segmentIndex).toBe(3)
    expect(placement?.tIn).toBe(60)
  })
})
