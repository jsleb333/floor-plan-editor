import { describe, expect, it } from 'vitest'

import {
  ALLOWED_DIRECTIONS,
  dirFromAngle,
  length,
  snapAngleDeg,
  snapDirection,
} from '@/utils/geometry'

import { expectPointClose } from './helpers'

describe('ALLOWED_DIRECTIONS', () => {
  it('contains the eight global-axis unit directions at 45° steps', () => {
    expect(ALLOWED_DIRECTIONS).toHaveLength(8)
    ALLOWED_DIRECTIONS.forEach((direction, index) => {
      expect(length(direction)).toBeCloseTo(1, 12)
      expectPointClose(direction, dirFromAngle((index * Math.PI) / 4))
    })
  })
})

describe('snapDirection', () => {
  it('snaps a 40° raw direction to the 45° diagonal', () => {
    const snapped = snapDirection(dirFromAngle((40 * Math.PI) / 180), true)
    expect(snapped).toEqual({ x: Math.SQRT1_2, y: Math.SQRT1_2 })
  })

  it('snaps a 10° raw direction to the +x axis', () => {
    expect(snapDirection(dirFromAngle((10 * Math.PI) / 180), true)).toEqual({ x: 1, y: 0 })
  })

  it('returns the normalized raw direction when snapping is disabled', () => {
    const snapped = snapDirection({ x: 3, y: 4 }, false)
    expectPointClose(snapped, { x: 0.6, y: 0.8 })
  })
})

describe('snapAngleDeg', () => {
  it('rounds to the nearest multiple of 45°', () => {
    expect(snapAngleDeg(40)).toBe(45)
    expect(snapAngleDeg(100)).toBe(90)
    expect(snapAngleDeg(22.4)).toBe(0)
  })

  it('preserves the sign of negative angles', () => {
    expect(snapAngleDeg(-40)).toBe(-45)
  })
})
