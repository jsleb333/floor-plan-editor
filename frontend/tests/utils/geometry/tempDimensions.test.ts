import { describe, expect, it } from 'vitest'

import { parallelFaceGaps } from '@/utils/geometry'
import type { GapSubject } from '@/utils/geometry'
import { makeWall } from '../../helpers/planFactory'
import { expectPointClose } from './helpers'

/** Horizontal subject segment on the x axis, 3½" centered: faces at y = ±1.75. */
const SUBJECT: GapSubject = {
  a: { x: 0, y: 0 },
  b: { x: 120, y: 0 },
  thicknessIn: 3.5,
  reference: 'center',
}

describe('parallelFaceGaps', () => {
  it('measures face to face against a parallel wall below (right of travel)', () => {
    // Neighbour at y=50, 4" centered: facing face at y=48. Gap = 48 - 1.75.
    const neighbour = makeWall({
      id: 'below',
      vertices: [
        { x: 0, y: 50 },
        { x: 120, y: 50 },
      ],
      thickness_in: 4,
    })
    const gaps = parallelFaceGaps(SUBJECT, [neighbour], { wallId: 'self', segmentIndex: 0 })
    expect(gaps.left).toBeNull()
    expect(gaps.right).not.toBeNull()
    expect(gaps.right?.distanceIn).toBeCloseTo(46.25)
    if (gaps.right) {
      expectPointClose(gaps.right.from, { x: 60, y: 1.75 })
      expectPointClose(gaps.right.to, { x: 60, y: 48 })
    }
  })

  it('measures both sides when parallel walls flank the segment', () => {
    const below = makeWall({
      id: 'below',
      vertices: [
        { x: 0, y: 50 },
        { x: 120, y: 50 },
      ],
      thickness_in: 4,
    })
    const above = makeWall({
      id: 'above',
      vertices: [
        { x: 0, y: -30 },
        { x: 120, y: -30 },
      ],
      thickness_in: 4,
    })
    const gaps = parallelFaceGaps(SUBJECT, [below, above], { wallId: 'self', segmentIndex: 0 })
    expect(gaps.right?.distanceIn).toBeCloseTo(46.25)
    expect(gaps.left?.distanceIn).toBeCloseTo(26.25)
  })

  it('keeps only the nearest face per side', () => {
    const near = makeWall({
      id: 'near',
      vertices: [
        { x: 0, y: 20 },
        { x: 120, y: 20 },
      ],
      thickness_in: 4,
    })
    const far = makeWall({
      id: 'far',
      vertices: [
        { x: 0, y: 60 },
        { x: 120, y: 60 },
      ],
      thickness_in: 4,
    })
    const gaps = parallelFaceGaps(SUBJECT, [far, near], { wallId: 'self', segmentIndex: 0 })
    expect(gaps.right?.distanceIn).toBeCloseTo(16.25)
  })

  it('measures the opposite side of the subject wall itself on a closed loop', () => {
    const room = makeWall({
      id: 'room',
      vertices: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: 96 },
        { x: 0, y: 96 },
      ],
      closed: true,
    })
    const gaps = parallelFaceGaps(SUBJECT, [room], { wallId: 'room', segmentIndex: 0 })
    // Interior gap: north inner face y = 96 - 1.75 to subject face y = 1.75.
    expect(gaps.right?.distanceIn).toBeCloseTo(92.5)
    expect(gaps.left).toBeNull()
  })

  it('ignores perpendicular walls and walls with no shared span', () => {
    const perpendicular = makeWall({
      id: 'perpendicular',
      vertices: [
        { x: 60, y: 10 },
        { x: 60, y: 90 },
      ],
    })
    const offside = makeWall({
      id: 'offside',
      vertices: [
        { x: 200, y: 50 },
        { x: 320, y: 50 },
      ],
    })
    const gaps = parallelFaceGaps(SUBJECT, [perpendicular, offside], {
      wallId: 'self',
      segmentIndex: 0,
    })
    expect(gaps.left).toBeNull()
    expect(gaps.right).toBeNull()
  })
})
