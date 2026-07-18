import { describe, expect, it } from 'vitest'

import type { Point } from '@/types/plan'
import { setSegmentLength } from '@/utils/geometry'
import type { ChainEditInput } from '@/utils/geometry'
import { expectPointsClose } from './helpers'

/**
 * Rectangle used across the closed-loop cases (y-down world):
 *   v0(0,0) --s0--> v1(120,0) --s1--> v2(120,96) --s2--> v3(0,96) --s3--> v0
 * s0/s2 are horizontal (parallel), s1/s3 vertical.
 */
function rectangle(lockedSegments: number[] = []): ChainEditInput {
  return {
    vertices: [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 96 },
      { x: 0, y: 96 },
    ],
    closed: true,
    lockedSegments,
  }
}

/** Open L-chain: v0(0,0) --s0--> v1(120,0) --s1--> v2(120,96). */
function lChain(lockedSegments: number[] = []): ChainEditInput {
  return {
    vertices: [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 96 },
    ],
    closed: false,
    lockedSegments,
  }
}

/** Open U-chain: v0(0,96) -s0- v1(0,0) -s1- v2(120,0) -s2- v3(120,96). */
function uChain(lockedSegments: number[] = []): ChainEditInput {
  return {
    vertices: [
      { x: 0, y: 96 },
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 96 },
    ],
    closed: false,
    lockedSegments,
  }
}

function expectOk(input: ChainEditInput, segment: number, target: number, vertices: Point[]): void {
  const result = setSegmentLength(input, segment, target)
  expect(result.status).toBe('ok')
  if (result.status === 'ok') expectPointsClose(result.vertices, vertices)
}

describe('setSegmentLength', () => {
  it('lengthens a rectangle side by moving the end vertex, absorbed by the opposite parallel side', () => {
    // Forward route wins the tie: v1 and v2 shift; the north wall s2 absorbs by lengthening.
    expectOk(rectangle(), 0, 144, [
      { x: 0, y: 0 },
      { x: 144, y: 0 },
      { x: 144, y: 96 },
      { x: 0, y: 96 },
    ])
  })

  it('shortens a rectangle side the same way, angles preserved', () => {
    expectOk(rectangle(), 0, 96, [
      { x: 0, y: 0 },
      { x: 96, y: 0 },
      { x: 96, y: 96 },
      { x: 0, y: 96 },
    ])
  })

  it('routes around a locked adjacent segment by moving the other endpoint', () => {
    // East wall s1 locked: the forward route is blocked, so v0/v3 shift west instead.
    expectOk(rectangle([1]), 0, 144, [
      { x: -24, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 96 },
      { x: -24, y: 96 },
    ])
  })

  it('keeps the forward route when the backward route is blocked', () => {
    expectOk(rectangle([3]), 0, 144, [
      { x: 0, y: 0 },
      { x: 144, y: 0 },
      { x: 144, y: 96 },
      { x: 0, y: 96 },
    ])
  })

  it('reports a misclosure when the opposite parallel side is locked (loop cannot absorb)', () => {
    // With s2 locked, s0's span is forced by the fixed verticals: geometrically impossible.
    const result = setSegmentLength(rectangle([2]), 0, 144)
    expect(result.status).toBe('misclosure')
    if (result.status === 'misclosure') {
      expect(result.misclosureIn).toBeCloseTo(24)
      expect(result.blockingSegments).toEqual([2])
    }
  })

  it('reports the S3c misclosure when every other segment of the loop is locked', () => {
    const result = setSegmentLength(rectangle([1, 2, 3]), 0, 121.5)
    expect(result.status).toBe('misclosure')
    if (result.status === 'misclosure') {
      expect(result.misclosureIn).toBeCloseTo(1.5)
      expect(result.blockingSegments).toEqual([1, 3])
    }
  })

  it('reports a misclosure on a closed loop with no parallel segment to absorb (wrap-around)', () => {
    const triangle: ChainEditInput = {
      vertices: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 0, y: 120 },
      ],
      closed: true,
      lockedSegments: [],
    }
    const result = setSegmentLength(triangle, 0, 100)
    expect(result.status).toBe('misclosure')
    if (result.status === 'misclosure') {
      expect(result.misclosureIn).toBeCloseTo(20)
      expect(result.blockingSegments).toEqual([])
    }
  })

  it('rejects editing a locked segment, flagging the segment itself', () => {
    const result = setSegmentLength(rectangle([0]), 0, 144)
    expect(result).toEqual({ status: 'blocked', blockingSegments: [0] })
  })

  it('moves only the free chain end for the last segment of an open chain', () => {
    // Forward route disturbs one vertex; the far elbow stays stationary.
    expectOk(lChain(), 1, 120, [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 120 },
    ])
  })

  it('moves only the free chain start for the first segment of an open chain', () => {
    expectOk(lChain(), 0, 144, [
      { x: -24, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 96 },
    ])
  })

  it('routes through the elbow when the cheap end is blocked by a lock', () => {
    // s0 locked on the L-chain: editing s1 must translate s0? No — s0 is
    // BEFORE s1; the backward route hits it, the forward route (free end) still wins.
    const result = setSegmentLength(lChain([0]), 1, 120)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expectPointsClose(result.vertices, [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: 120 },
      ])
    }
  })

  it('translates the elbow segment when the near end is locked', () => {
    // Editing s0 with a locked... use the U-chain: edit the bottom s1 with s2 locked.
    // Forward (via s2) is blocked; backward translates s0's shared vertex and
    // the chain start absorbs.
    expectOk(uChain([2]), 1, 144, [
      { x: -24, y: 96 },
      { x: -24, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 96 },
    ])
  })

  it('breaks route ties toward the segment end vertex on a symmetric open chain', () => {
    expectOk(uChain(), 1, 144, [
      { x: 0, y: 96 },
      { x: 0, y: 0 },
      { x: 144, y: 0 },
      { x: 144, y: 96 },
    ])
  })

  it('rejects with both blocking locks when both arms of an open chain are locked', () => {
    const result = setSegmentLength(uChain([0, 2]), 1, 144)
    expect(result).toEqual({ status: 'blocked', blockingSegments: [0, 2] })
  })

  it('absorbs into a collinear free neighbour without moving the far vertices', () => {
    const straight: ChainEditInput = {
      vertices: [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 180, y: 0 },
      ],
      closed: false,
      lockedSegments: [],
    }
    expectOk(straight, 0, 100, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 180, y: 0 },
    ])
  })

  it('returns the vertices unchanged when the target equals the current length', () => {
    expectOk(rectangle([1, 2, 3]), 0, 120, [...rectangle().vertices])
  })

  it('rejects non-positive targets and out-of-range segment indices', () => {
    expect(setSegmentLength(rectangle(), 0, 0)).toEqual({
      status: 'blocked',
      blockingSegments: [],
    })
    expect(setSegmentLength(rectangle(), 4, 100)).toEqual({
      status: 'blocked',
      blockingSegments: [],
    })
    expect(setSegmentLength(lChain(), 2, 100)).toEqual({
      status: 'blocked',
      blockingSegments: [],
    })
  })
})
