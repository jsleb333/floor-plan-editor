import { describe, expect, it } from 'vitest'

import {
  lineIntersection,
  projectPointOnPolyline,
  projectPointOnSegment,
  segmentIntersection,
} from '@/utils/geometry'

import { expectPointClose } from './helpers'

describe('lineIntersection', () => {
  it('intersects perpendicular lines', () => {
    const point = lineIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 5, y: -5 }, { x: 0, y: 1 })
    expect(point).not.toBeNull()
    expectPointClose(point ?? { x: NaN, y: NaN }, { x: 5, y: 0 })
  })

  it('accepts non-unit directions', () => {
    const point = lineIntersection({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 10, y: 0 }, { x: -3, y: 3 })
    expect(point).not.toBeNull()
    expectPointClose(point ?? { x: NaN, y: NaN }, { x: 5, y: 5 })
  })

  it('returns null for parallel lines', () => {
    expect(
      lineIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 5 }, { x: 2, y: 0 }),
    ).toBeNull()
  })

  it('returns null for collinear lines', () => {
    expect(
      lineIntersection({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 3, y: 3 }, { x: -2, y: -2 }),
    ).toBeNull()
  })
})

describe('segmentIntersection', () => {
  it('finds the crossing point of two segments', () => {
    const point = segmentIntersection(
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    )
    expect(point).not.toBeNull()
    expectPointClose(point ?? { x: NaN, y: NaN }, { x: 5, y: 5 })
  })

  it('includes segment endpoints', () => {
    const point = segmentIntersection(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 10 },
    )
    expect(point).not.toBeNull()
    expectPointClose(point ?? { x: NaN, y: NaN }, { x: 5, y: 0 })
  })

  it('returns null when the infinite lines cross outside the segments', () => {
    expect(
      segmentIntersection({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 0 }, { x: 5, y: -10 }),
    ).toBeNull()
  })

  it('returns null for parallel segments', () => {
    expect(
      segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }),
    ).toBeNull()
  })
})

describe('projectPointOnSegment', () => {
  it('projects orthogonally inside the segment', () => {
    const projection = projectPointOnSegment({ x: 5, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expectPointClose(projection.point, { x: 5, y: 0 })
    expect(projection.t).toBeCloseTo(0.5, 12)
    expect(projection.tRaw).toBeCloseTo(0.5, 12)
    expect(projection.distance).toBeCloseTo(4, 12)
  })

  it('clamps beyond the end while keeping the raw parameter', () => {
    const projection = projectPointOnSegment({ x: 20, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expectPointClose(projection.point, { x: 10, y: 0 })
    expect(projection.t).toBe(1)
    expect(projection.tRaw).toBeCloseTo(2, 12)
    expect(projection.distance).toBeCloseTo(Math.hypot(10, 5), 12)
  })

  it('clamps before the start while keeping the raw parameter', () => {
    const projection = projectPointOnSegment({ x: -5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expectPointClose(projection.point, { x: 0, y: 0 })
    expect(projection.t).toBe(0)
    expect(projection.tRaw).toBeCloseTo(-0.5, 12)
    expect(projection.distance).toBeCloseTo(Math.hypot(5, 3), 12)
  })

  it('projects onto the point itself for a degenerate segment', () => {
    const projection = projectPointOnSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })
    expectPointClose(projection.point, { x: 0, y: 0 })
    expect(projection.t).toBe(0)
    expect(projection.tRaw).toBe(0)
    expect(projection.distance).toBeCloseTo(5, 12)
  })
})

describe('projectPointOnPolyline', () => {
  const polyline = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ]

  it('picks the closest segment and reports its index', () => {
    const projection = projectPointOnPolyline({ x: 12, y: 3 }, polyline)
    expect(projection).not.toBeNull()
    expectPointClose(projection?.point ?? { x: NaN, y: NaN }, { x: 10, y: 3 })
    expect(projection?.segmentIndex).toBe(1)
    expect(projection?.t).toBeCloseTo(0.3, 12)
    expect(projection?.distance).toBeCloseTo(2, 12)
  })

  it('projects onto the first segment when it is closest', () => {
    const projection = projectPointOnPolyline({ x: 3, y: -4 }, polyline)
    expectPointClose(projection?.point ?? { x: NaN, y: NaN }, { x: 3, y: 0 })
    expect(projection?.segmentIndex).toBe(0)
    expect(projection?.distance).toBeCloseTo(4, 12)
  })

  it('returns null for fewer than two vertices', () => {
    expect(projectPointOnPolyline({ x: 0, y: 0 }, [{ x: 1, y: 1 }])).toBeNull()
    expect(projectPointOnPolyline({ x: 0, y: 0 }, [])).toBeNull()
  })
})
