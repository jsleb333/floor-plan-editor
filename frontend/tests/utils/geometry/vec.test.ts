import { describe, expect, it } from 'vitest'

import type { Point } from '@/types/plan'
import {
  add,
  angleOf,
  cross,
  dirFromAngle,
  distance,
  dot,
  length,
  lerp,
  normalize,
  perpendicular,
  scale,
  sideOf,
  sub,
} from '@/utils/geometry'

import { expectPointClose } from './helpers'

describe('basic vector arithmetic', () => {
  it('adds, subtracts and scales component-wise', () => {
    expect(add({ x: 1, y: 2 }, { x: 3, y: -5 })).toEqual({ x: 4, y: -3 })
    expect(sub({ x: 1, y: 2 }, { x: 3, y: -5 })).toEqual({ x: -2, y: 7 })
    expect(scale({ x: 2, y: -3 }, 2.5)).toEqual({ x: 5, y: -7.5 })
  })

  it('computes dot product, length and distance', () => {
    expect(dot({ x: 2, y: 3 }, { x: 4, y: -1 })).toBe(5)
    expect(length({ x: 3, y: 4 })).toBe(5)
    expect(distance({ x: 1, y: 1 }, { x: 4, y: 5 })).toBe(5)
  })

  it('interpolates linearly, unclamped', () => {
    expect(lerp({ x: 0, y: 0 }, { x: 10, y: -4 }, 0.5)).toEqual({ x: 5, y: -2 })
    expect(lerp({ x: 0, y: 0 }, { x: 10, y: -4 }, 2)).toEqual({ x: 20, y: -8 })
  })
})

describe('cross', () => {
  it('is positive when the second vector points right of the first (y-down)', () => {
    expect(cross({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1)
    expect(cross({ x: 1, y: 0 }, { x: 0, y: -1 })).toBe(-1)
  })
})

describe('normalize', () => {
  it('returns a unit vector in the same direction', () => {
    expectPointClose(normalize({ x: 3, y: 4 }), { x: 0.6, y: 0.8 })
  })

  it('returns the zero vector for a zero-length input', () => {
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
  })
})

describe('angleOf and dirFromAngle', () => {
  it('measures angles from +x toward +y (down-screen is +90°)', () => {
    expect(angleOf({ x: 0, y: 1 })).toBeCloseTo(Math.PI / 2, 12)
    expect(angleOf({ x: 0, y: -1 })).toBeCloseTo(-Math.PI / 2, 12)
  })

  it('round-trips through dirFromAngle', () => {
    const angle = Math.PI / 3
    expect(angleOf(dirFromAngle(angle))).toBeCloseTo(angle, 12)
    expectPointClose(dirFromAngle(0), { x: 1, y: 0 })
  })
})

describe('sideOf and perpendicular consistency', () => {
  it('reports up-screen as left when walking east', () => {
    expect(sideOf({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: -2 })).toBe('left')
    expect(sideOf({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: 2 })).toBe('right')
    expect(sideOf({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 })).toBe('on')
  })

  it('rotates east to up-screen (the left of travel)', () => {
    expectPointClose(perpendicular({ x: 1, y: 0 }), { x: 0, y: -1 })
    expectPointClose(perpendicular({ x: 0, y: 1 }), { x: 1, y: 0 })
  })

  it('always lands perpendicular() on the left side of travel, for any direction', () => {
    const base: Point = { x: 5, y: 7 }
    const directions: Point[] = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 1, y: 1 },
      { x: -2, y: 3 },
      { x: 0.4, y: -9 },
    ]
    for (const direction of directions) {
      const ahead = add(base, direction)
      expect(sideOf(base, ahead, add(base, perpendicular(direction)))).toBe('left')
      expect(sideOf(base, ahead, sub(base, perpendicular(direction)))).toBe('right')
    }
  })
})
