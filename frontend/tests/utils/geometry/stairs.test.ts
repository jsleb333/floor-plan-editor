import { describe, expect, it } from 'vitest'

import { stairsArrow, stairsCenter, stairsCorners, stairsTreads } from '@/utils/geometry'
import { makeStairs } from '../../helpers/planFactory'

describe('stairsCorners', () => {
  it('builds the rectangle from origin along the run, width across (right of travel)', () => {
    expect(stairsCorners(makeStairs())).toEqual([
      { x: 0, y: 0 },
      { x: 96, y: 0 },
      { x: 96, y: 36 },
      { x: 0, y: 36 },
    ])
  })

  it('rotates the rectangle around the origin corner', () => {
    const corners = stairsCorners(makeStairs({ rotation_deg: 90 }))

    // 90 degrees heads down-screen (+y); right of travel is -x.
    expect(corners[0]).toEqual({ x: 0, y: 0 })
    expect(corners[1].x).toBeCloseTo(0, 10)
    expect(corners[1].y).toBeCloseTo(96, 10)
    expect(corners[2].x).toBeCloseTo(-36, 10)
    expect(corners[2].y).toBeCloseTo(96, 10)
    expect(corners[3].x).toBeCloseTo(-36, 10)
    expect(corners[3].y).toBeCloseTo(0, 10)
  })
})

describe('stairsTreads', () => {
  it('spaces tread lines every 10 inches across the full width, excluding the ends', () => {
    const treads = stairsTreads(makeStairs({ length_in: 96 }))

    expect(treads).toHaveLength(9)
    expect(treads[0]).toEqual({ a: { x: 10, y: 0 }, b: { x: 10, y: 36 } })
    expect(treads[8]).toEqual({ a: { x: 90, y: 0 }, b: { x: 90, y: 36 } })
  })

  it('emits no tread at the far edge when the length is an exact multiple', () => {
    const treads = stairsTreads(makeStairs({ length_in: 30 }))

    expect(treads.map((tread) => tread.a.x)).toEqual([10, 20])
  })
})

describe('stairsArrow', () => {
  it('points along the run for direction up and back for down', () => {
    const up = stairsArrow(makeStairs())
    expect(up.tail.x).toBeLessThan(up.head.x)
    expect(up.tail.y).toBe(18)

    const down = stairsArrow(makeStairs({ direction: 'down' }))
    expect(down.tail.x).toBeGreaterThan(down.head.x)
  })
})

describe('stairsCenter', () => {
  it('returns the centre of the rectangle', () => {
    expect(stairsCenter(makeStairs())).toEqual({ x: 48, y: 18 })
  })
})
