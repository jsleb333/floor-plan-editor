import { describe, expect, it } from 'vitest'

import { autoSquareClose } from '@/utils/geometry'

import { expectPointClose } from './helpers'

describe('autoSquareClose', () => {
  it('solves the classic right-angle close', () => {
    // Chain heading north (up-screen) at (10, 0); loop starts at (0, -10).
    // Best close: corner at (10, -10), then arrive heading west.
    const result = autoSquareClose({ x: 10, y: 0 }, { x: 0, y: -1 }, { x: 0, y: -10 })
    expect(result).not.toBeNull()
    expectPointClose(result?.corner ?? { x: NaN, y: NaN }, { x: 10, y: -10 })
    expect(result?.arrivalDir).toEqual({ x: -1, y: 0 })
  })

  it('normalizes a non-unit current direction', () => {
    const result = autoSquareClose({ x: 10, y: 0 }, { x: 0, y: -7 }, { x: 0, y: -10 })
    expectPointClose(result?.corner ?? { x: NaN, y: NaN }, { x: 10, y: -10 })
    expect(result?.arrivalDir).toEqual({ x: -1, y: 0 })
  })

  it('picks a 45° arrival when it minimizes the added length', () => {
    // Heading east at the origin; start vertex up-right at (20, -10).
    // Corner (10, 0) + 45° up-right arrival (total ~24.1) beats
    // corner (20, 0) + north arrival (total 30).
    const result = autoSquareClose({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 20, y: -10 })
    expect(result).not.toBeNull()
    expectPointClose(result?.corner ?? { x: NaN, y: NaN }, { x: 10, y: 0 })
    expect(result?.arrivalDir).toEqual({ x: Math.SQRT1_2, y: -Math.SQRT1_2 })
  })

  it('returns null when the start vertex lies behind on the heading line', () => {
    expect(autoSquareClose({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -10, y: 0 })).toBeNull()
  })

  it('returns null when the heading already passes through the start vertex', () => {
    expect(autoSquareClose({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 0 })).toBeNull()
  })

  it('returns null for a zero current direction', () => {
    expect(autoSquareClose({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 })).toBeNull()
  })
})
