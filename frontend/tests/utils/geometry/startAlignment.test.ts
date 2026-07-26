import { describe, expect, it } from 'vitest'

import { alignFree, alignOnRay } from '@/utils/geometry'

import { expectPointClose } from './helpers'

describe('alignOnRay', () => {
  it('snaps the ray point onto the vertical alignment line through the start', () => {
    // Drawing west along y=80; the vertical line through the start crosses at
    // t=100, two inches ahead of the current point.
    const result = alignOnRay({ x: 100, y: 80 }, { x: -1, y: 0 }, { x: 0, y: 0 }, 98, 10)
    expect(result).not.toBeNull()
    expectPointClose(result?.point ?? { x: NaN, y: NaN }, { x: 0, y: 80 })
    expectPointClose(result?.guideDir ?? { x: NaN, y: NaN }, { x: 0, y: 1 })
  })

  it('picks the nearest crossing when two alignment lines are within tolerance', () => {
    // Crossings at t=25 (45° line, 6" away) and t=40 (vertical line, 9" away).
    const result = alignOnRay({ x: 40, y: 15 }, { x: -1, y: 0 }, { x: 0, y: 0 }, 31, 10)
    expect(result).not.toBeNull()
    expectPointClose(result?.point ?? { x: NaN, y: NaN }, { x: 15, y: 15 })
    expectPointClose(result?.guideDir ?? { x: NaN, y: NaN }, { x: Math.SQRT1_2, y: Math.SQRT1_2 })
  })

  it('returns null when the nearest crossing is beyond the tolerance along the ray', () => {
    expect(alignOnRay({ x: 40, y: 15 }, { x: -1, y: 0 }, { x: 0, y: 0 }, 80, 10)).toBeNull()
  })

  it('ignores crossings behind the ray origin', () => {
    // Heading south from (240,0): the horizontal line crosses at the origin
    // itself (t=0) and the 135° line behind it (t=-240).
    expect(alignOnRay({ x: 240, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 0 }, 5, 10)).toBeNull()
  })

  it('ignores an alignment line parallel to the ray', () => {
    // The ray runs 5" from the horizontal line through the start — within
    // tolerance perpendicular-wise, but unreachable by moving along the ray.
    expect(alignOnRay({ x: 0, y: 5 }, { x: 1, y: 0 }, { x: 0, y: 0 }, 50, 10)).toBeNull()
  })

  it('rejects a crossing that coincides with the start vertex', () => {
    // Heading straight at the start: every line through it crosses exactly
    // there, which belongs to the close affordance, not alignment.
    const along = 20 * Math.SQRT2
    const dir = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }
    expect(alignOnRay({ x: 20, y: 20 }, dir, { x: 0, y: 0 }, along, 10)).toBeNull()
  })
})

describe('alignFree', () => {
  it('projects a free cursor onto the nearest alignment line and orients the guide from the start', () => {
    const result = alignFree({ x: 1.5, y: 60 }, { x: 0, y: 0 }, 10)
    expect(result).not.toBeNull()
    expectPointClose(result?.point ?? { x: NaN, y: NaN }, { x: 0, y: 60 })
    expectPointClose(result?.guideDir ?? { x: NaN, y: NaN }, { x: 0, y: 1 })
  })

  it('returns null when every alignment line is beyond the tolerance', () => {
    expect(alignFree({ x: 100, y: 80 }, { x: 0, y: 0 }, 10)).toBeNull()
  })
})
