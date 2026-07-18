import { describe, expect, it } from 'vitest'

import {
  AUTO_CURVE_FACTOR,
  autoCurveControlPoints,
  sampleWirePoints,
  wireHitDistance,
  wirePathData,
} from '@/utils/geometry'

describe('autoCurveControlPoints', () => {
  it('places control points at 1/3 and 2/3, offset 15% to the left, deterministically', () => {
    const from = { x: 0, y: 0 }
    const to = { x: 120, y: 0 }
    const [c1, c2] = autoCurveControlPoints(from, to)

    // Left of an east-bound walk is up-screen (negative y) in y-down space.
    const offset = 120 * AUTO_CURVE_FACTOR
    expect(c1).toEqual({ x: 40, y: -offset })
    expect(c2).toEqual({ x: 80, y: -offset })
    // Deterministic: same inputs, same output.
    expect(autoCurveControlPoints(from, to)).toEqual([c1, c2])
  })

  it('collapses to the source for a zero-length span', () => {
    const from = { x: 5, y: 5 }
    expect(autoCurveControlPoints(from, { ...from })).toEqual([from, from])
  })
})

describe('wirePathData', () => {
  it('emits a single cubic for the canonical two control points', () => {
    const path = wirePathData(
      { x: 0, y: 0 },
      [
        { x: 40, y: -18 },
        { x: 80, y: -18 },
      ],
      { x: 120, y: 0 },
    )
    expect(path).toBe('M 0 0 C 40 -18 80 -18 120 0')
  })

  it('falls back to a Catmull-Rom spline for other control-point counts', () => {
    const path = wirePathData({ x: 0, y: 0 }, [{ x: 60, y: 20 }], { x: 120, y: 0 })
    expect(path.startsWith('M 0 0 C')).toBe(true)
    // One interior point → two cubic segments through the spline vertices.
    expect(path.match(/C/g)?.length).toBe(2)
  })
})

describe('wireHitDistance', () => {
  const from = { x: 0, y: 0 }
  const to = { x: 120, y: 0 }
  const controlPoints = autoCurveControlPoints(from, to)

  it('is near zero for a point on the sampled curve', () => {
    const mid = sampleWirePoints(from, controlPoints, to, 24)[12]
    expect(wireHitDistance(mid, from, controlPoints, to)).toBeLessThan(1)
  })

  it('grows with distance from the curve', () => {
    const near = wireHitDistance({ x: 60, y: -18 }, from, controlPoints, to)
    const far = wireHitDistance({ x: 60, y: -60 }, from, controlPoints, to)
    expect(far).toBeGreaterThan(near)
  })
})
