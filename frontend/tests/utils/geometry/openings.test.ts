import { describe, expect, it } from 'vitest'

import type { DoorStyle } from '@/types/plan'
import {
  clampOpeningT,
  doorFigure,
  doorSymbol,
  openingJambs,
  openingWorldRect,
  projectOntoWalls,
  windowSymbol,
} from '@/utils/geometry'
import { doorStrokeToPath } from '@/utils/svgPath'
import { makeOpening, makeWall } from '../../helpers/planFactory'

const ALL_STYLES: readonly DoorStyle[] = [
  'swing',
  'double',
  'sliding',
  'bifold',
  'double_bifold',
  'pocket',
]

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

describe('doorFigure', () => {
  /** 10' wall on the x axis, 3.5" thick, centred: jambs at x=44 and x=76, mid at x=60. */
  const wall = makeWall()

  it('draws the swing style as exactly the doorSymbol leaf and arc', () => {
    const opening = makeOpening({ t: 60, width_in: 32, style: 'swing' })
    const symbol = doorSymbol(wall, opening)
    const figure = doorFigure(wall, opening)

    expect(figure?.style).toBe('swing')
    expect(figure?.strokes).toEqual([
      {
        points: [
          { x: 44, y: 0 },
          { x: 44, y: -32 },
        ],
        arc: { to: { x: 76, y: 0 }, radiusIn: 32, sweep: 1 },
        dashed: false,
      },
    ])
    // The rendered path is byte-for-byte the pre-style one built from doorSymbol.
    expect(doorStrokeToPath(figure?.strokes[0] ?? { points: [], arc: null, dashed: false })).toBe(
      `M ${symbol?.hinge.x} ${symbol?.hinge.y} L ${symbol?.leafEnd.x} ${symbol?.leafEnd.y} ` +
        `A ${symbol?.radiusIn} ${symbol?.radiusIn} 0 0 ${symbol?.sweep} ${symbol?.arcEnd.x} ${symbol?.arcEnd.y}`,
    )
  })

  it('draws a double door as two half-width leaves hinged at opposite jambs', () => {
    const figure = doorFigure(wall, makeOpening({ t: 60, width_in: 32, style: 'double' }))

    expect(figure?.strokes).toEqual([
      {
        points: [
          { x: 44, y: 0 },
          { x: 44, y: -16 },
        ],
        arc: { to: { x: 60, y: 0 }, radiusIn: 16, sweep: 1 },
        dashed: false,
      },
      {
        points: [
          { x: 76, y: 0 },
          { x: 76, y: -16 },
        ],
        arc: { to: { x: 60, y: 0 }, radiusIn: 16, sweep: 0 },
        dashed: false,
      },
    ])
  })

  it('swings both leaves of a double door to the swing side, mirroring the sweeps', () => {
    const figure = doorFigure(
      wall,
      makeOpening({ t: 60, width_in: 32, style: 'double', swing: 'out' }),
    )

    expect(figure?.strokes.map((stroke) => stroke.points[1])).toEqual([
      { x: 44, y: 16 },
      { x: 76, y: 16 },
    ])
    expect(figure?.strokes.map((stroke) => stroke.arc?.sweep)).toEqual([0, 1])
  })

  it('ignores the hinge side of a double door', () => {
    const left = doorFigure(wall, makeOpening({ style: 'double', hinge: 'left' }))
    const right = doorFigure(wall, makeOpening({ style: 'double', hinge: 'right' }))

    expect(left).toEqual(right)
  })

  it('draws a slider as two half-opening panels on opposite faces, hinge picking the halves', () => {
    const left = doorFigure(wall, makeOpening({ t: 60, width_in: 32, style: 'sliding' }))
    const right = doorFigure(
      wall,
      makeOpening({ t: 60, width_in: 32, style: 'sliding', hinge: 'right' }),
    )

    // Panels sit a quarter of the 3.5" thickness either side of the wall centre.
    expect(left?.strokes).toEqual([
      {
        points: [
          { x: 44, y: -0.875 },
          { x: 60, y: -0.875 },
        ],
        arc: null,
        dashed: false,
      },
      {
        points: [
          { x: 60, y: 0.875 },
          { x: 76, y: 0.875 },
        ],
        arc: null,
        dashed: false,
      },
    ])
    expect(right?.strokes.map((stroke) => stroke.points.map((point) => point.y))).toEqual([
      [0.875, 0.875],
      [-0.875, -0.875],
    ])
  })

  it('keeps the sliding panels within the wall thickness on a thick wall', () => {
    const thick = makeWall({ thickness_in: 8 })
    const figure = doorFigure(thick, makeOpening({ t: 60, width_in: 32, style: 'sliding' }))

    for (const stroke of figure?.strokes ?? []) {
      for (const point of stroke.points) expect(Math.abs(point.y)).toBeLessThanOrEqual(4)
    }
  })

  it('draws a bifold as a shallow V of two equal leaves from the stack jamb to the mid-point', () => {
    const figure = doorFigure(wall, makeOpening({ t: 60, width_in: 32, style: 'bifold' }))

    expect(figure?.strokes).toEqual([
      {
        points: [
          { x: 44, y: 0 },
          { x: 52, y: -8 },
          { x: 60, y: 0 },
        ],
        arc: null,
        dashed: false,
      },
    ])
  })

  it('stacks the bifold at the other jamb and folds to the other side on demand', () => {
    const figure = doorFigure(
      wall,
      makeOpening({ t: 60, width_in: 32, style: 'bifold', hinge: 'right', swing: 'out' }),
    )

    expect(figure?.strokes[0].points).toEqual([
      { x: 76, y: 0 },
      { x: 68, y: 8 },
      { x: 60, y: 0 },
    ])
  })

  it('draws a 60" double bifold as one folded pair per jamb, meeting at the opening centre', () => {
    const figure = doorFigure(wall, makeOpening({ t: 60, width_in: 60, style: 'double_bifold' }))

    // Jambs at x=30/90, centre at x=60: two Vs of two 15" leaves each, folding
    // 15" into the room (swing 'in' is up-screen on this east-running wall).
    expect(figure?.style).toBe('double_bifold')
    expect(figure?.strokes).toEqual([
      {
        points: [
          { x: 30, y: 0 },
          { x: 45, y: -15 },
          { x: 60, y: 0 },
        ],
        arc: null,
        dashed: false,
      },
      {
        points: [
          { x: 90, y: 0 },
          { x: 75, y: -15 },
          { x: 60, y: 0 },
        ],
        arc: null,
        dashed: false,
      },
    ])
  })

  it('builds each half of a double bifold exactly like the single bifold V', () => {
    const options = { t: 60, width_in: 60 } as const
    const pair = doorFigure(wall, makeOpening({ ...options, style: 'double_bifold' }))
    const stackedLeft = doorFigure(wall, makeOpening({ ...options, style: 'bifold' }))
    const stackedRight = doorFigure(
      wall,
      makeOpening({ ...options, style: 'bifold', hinge: 'right' }),
    )

    expect(pair?.strokes[0]).toEqual(stackedLeft?.strokes[0])
    expect(pair?.strokes[1]).toEqual(stackedRight?.strokes[0])
  })

  it('folds both pairs of a double bifold to the swing side and ignores the hinge side', () => {
    const out = doorFigure(
      wall,
      makeOpening({ t: 60, width_in: 60, style: 'double_bifold', swing: 'out' }),
    )
    const hingedRight = doorFigure(
      wall,
      makeOpening({ t: 60, width_in: 60, style: 'double_bifold', hinge: 'right' }),
    )
    const hingedLeft = doorFigure(
      wall,
      makeOpening({ t: 60, width_in: 60, style: 'double_bifold' }),
    )

    expect(out?.strokes.map((stroke) => stroke.points[1])).toEqual([
      { x: 45, y: 15 },
      { x: 75, y: 15 },
    ])
    expect(hingedRight).toEqual(hingedLeft)
  })

  it('draws a pocket door inside the wall with a dashed cavity beyond the hinge jamb', () => {
    const figure = doorFigure(wall, makeOpening({ t: 60, width_in: 32, style: 'pocket' }))

    expect(figure?.strokes).toEqual([
      {
        points: [
          { x: 44, y: 0 },
          { x: 76, y: 0 },
        ],
        arc: null,
        dashed: false,
      },
      {
        points: [
          { x: 44, y: 0 },
          { x: 12, y: 0 },
        ],
        arc: null,
        dashed: true,
      },
    ])
  })

  it('runs the pocket cavity the other way for a right-hand pocket', () => {
    const figure = doorFigure(
      wall,
      makeOpening({ t: 60, width_in: 32, style: 'pocket', hinge: 'right' }),
    )

    expect(figure?.strokes[1].points).toEqual([
      { x: 76, y: 0 },
      { x: 108, y: 0 },
    ])
  })

  it('keeps the pocket leaf inside the wall band on a one-sided reference', () => {
    const offsetWall = makeWall({ thickness_in: 6, reference: 'left' })
    const figure = doorFigure(offsetWall, makeOpening({ t: 60, width_in: 32, style: 'pocket' }))

    // Reference IS the left face, so the band spans y in [0, 6]; the leaf is mid-band.
    expect(figure?.strokes[0].points).toEqual([
      { x: 44, y: 3 },
      { x: 76, y: 3 },
    ])
  })

  it('clamps the pocket cavity to the reference line left on that side of the segment', () => {
    const short = doorFigure(wall, makeOpening({ t: 20, width_in: 32, style: 'pocket' }))
    const none = doorFigure(wall, makeOpening({ t: 5, width_in: 32, style: 'pocket' }))

    // Jamb at x=4, so only 4" of cavity fits before the segment start.
    expect(short?.strokes[1].points).toEqual([
      { x: 4, y: 0 },
      { x: 0, y: 0 },
    ])
    // t clamps to 16: the jamb sits on the segment start, leaving no cavity at all.
    expect(none?.strokes).toHaveLength(1)
  })

  it('derives every style from the host wall, following a rotated segment', () => {
    const vertical = makeWall({
      vertices: [
        { x: 10, y: 0 },
        { x: 10, y: 200 },
      ],
    })
    const figure = doorFigure(vertical, makeOpening({ t: 100, width_in: 32, style: 'bifold' }))

    // Travel is +y, so 'left of travel' (swing 'in') is +x in y-down space.
    expect(figure?.strokes[0].points).toEqual([
      { x: 10, y: 84 },
      { x: 18, y: 92 },
      { x: 10, y: 100 },
    ])

    const pair = doorFigure(vertical, makeOpening({ t: 100, width_in: 60, style: 'double_bifold' }))
    expect(pair?.strokes.map((stroke) => stroke.points)).toEqual([
      [
        { x: 10, y: 70 },
        { x: 25, y: 85 },
        { x: 10, y: 100 },
      ],
      [
        { x: 10, y: 130 },
        { x: 25, y: 115 },
        { x: 10, y: 100 },
      ],
    ])
  })

  it('returns null for an out-of-range segment index, whatever the style', () => {
    for (const style of ALL_STYLES) {
      expect(doorFigure(makeWall(), makeOpening({ segment_index: 5, style }))).toBeNull()
    }
  })

  it('leaves the jambs and the opening rectangle untouched by the style', () => {
    const jambs = openingJambs(wall, makeOpening({ t: 60, width_in: 32 }))
    const rect = openingWorldRect(wall, makeOpening({ t: 60, width_in: 32 }))

    for (const style of ALL_STYLES) {
      const opening = makeOpening({ t: 60, width_in: 32, style })
      expect(openingJambs(wall, opening)).toEqual(jambs)
      expect(openingWorldRect(wall, opening)).toEqual(rect)
    }
  })

  it('scales to a 60" closet opening without leaving the segment', () => {
    const figure = doorFigure(wall, makeOpening({ t: 60, width_in: 60, style: 'double' }))

    expect(figure?.strokes.map((stroke) => stroke.points[0])).toEqual([
      { x: 30, y: 0 },
      { x: 90, y: 0 },
    ])
    expect(figure?.strokes.every((stroke) => stroke.arc?.radiusIn === 30)).toBe(true)
  })
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
