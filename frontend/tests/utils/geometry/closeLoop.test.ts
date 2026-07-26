import { describe, expect, it } from 'vitest'

import { alignedClose, autoSquareClose } from '@/utils/geometry'

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

describe('alignedClose', () => {
  it('slides the chain end along its final segment onto the line through the start', () => {
    // Final segment heads west along y=80, ending 2" past the vertical line
    // through the start; sliding reaches (0,80) exactly.
    const result = alignedClose({ x: 100, y: 80 }, { x: 2, y: 80 }, { x: 0, y: 0 }, 10)
    expect(result).not.toBeNull()
    expectPointClose(result ?? { x: NaN, y: NaN }, { x: 0, y: 80 })
  })

  it('projects perpendicularly when the final segment is parallel to the alignment line', () => {
    // Final segment runs 2" above the horizontal line through the start:
    // sliding can never reach it, so the end drops straight onto the line.
    const result = alignedClose({ x: 100, y: 2 }, { x: 20, y: 2 }, { x: 0, y: 0 }, 10)
    expect(result).not.toBeNull()
    expectPointClose(result ?? { x: NaN, y: NaN }, { x: 20, y: 0 })
  })

  it('returns the chain end unchanged when it already lies on an alignment line', () => {
    const result = alignedClose({ x: 100, y: 80 }, { x: 0, y: 80 }, { x: 0, y: 0 }, 10)
    expect(result).not.toBeNull()
    expectPointClose(result ?? { x: NaN, y: NaN }, { x: 0, y: 80 })
  })

  it('returns null for a genuinely L-shaped close beyond the tolerance', () => {
    expect(alignedClose({ x: 240, y: 0 }, { x: 240, y: 120 }, { x: 0, y: 0 }, 10)).toBeNull()
  })

  it('returns null when the correction would reverse the final segment', () => {
    // The vertical line through the start lies behind the final segment's
    // own start vertex, so sliding onto it would flip the segment.
    expect(alignedClose({ x: 1, y: 80 }, { x: 2, y: 80 }, { x: 0, y: 0 }, 10)).toBeNull()
  })

  it('returns null when the chain end heads straight at the start off-axis', () => {
    // Every slide lands exactly on the start vertex (degenerate closing
    // segment), so the caller falls back to the auto-square close.
    expect(alignedClose({ x: 17.32, y: 10 }, { x: 8.66, y: 5 }, { x: 0, y: 0 }, 10)).toBeNull()
  })
})
