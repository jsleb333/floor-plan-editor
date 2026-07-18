import { describe, expect, it } from 'vitest'

import {
  dimensionHitTest,
  dimensionLayout,
  dimensionOffsetFor,
  labelBounds,
  labelFontSizeIn,
} from '@/utils/geometry'
import { makeDimension, makeLabel } from '../../helpers/planFactory'

describe('dimensionLayout', () => {
  it('offsets the dimension line perpendicular to p1 -> p2 and measures live', () => {
    const layout = dimensionLayout(makeDimension({ offset_in: 12 }))

    // Travel +x; positive offset is left of travel = up-screen (-y).
    expect(layout?.line).toEqual({ a: { x: 0, y: -12 }, b: { x: 120, y: -12 } })
    expect(layout?.distanceIn).toBe(120)
    expect(layout?.textAngleDeg).toBe(0)
    expect(layout?.textAnchor).toEqual({ x: 60, y: -14.5 })
  })

  it('runs extension lines from each anchor toward the offset side with an overshoot', () => {
    const layout = dimensionLayout(makeDimension({ offset_in: 12 }))

    expect(layout?.extensions).toEqual([
      { a: { x: 0, y: -1.5 }, b: { x: 0, y: -14 } },
      { a: { x: 120, y: -1.5 }, b: { x: 120, y: -14 } },
    ])
  })

  it('flips to the other side for a negative offset', () => {
    const layout = dimensionLayout(makeDimension({ offset_in: -12 }))

    expect(layout?.line.a).toEqual({ x: 0, y: 12 })
    expect(layout?.extensions[0].a).toEqual({ x: 0, y: 1.5 })
    expect(layout?.extensions[0].b).toEqual({ x: 0, y: 14 })
  })

  it('keeps the text upright for right-to-left dimensions', () => {
    const layout = dimensionLayout(makeDimension({ p1: { x: 120, y: 0 }, p2: { x: 0, y: 0 } }))

    expect(layout?.textAngleDeg).toBe(0)
  })

  it('updates the measured distance when an anchor moves', () => {
    const layout = dimensionLayout(makeDimension({ p2: { x: 90, y: 0 } }))

    expect(layout?.distanceIn).toBe(90)
  })

  it('returns null for coincident anchors', () => {
    expect(dimensionLayout(makeDimension({ p2: { x: 0, y: 0 } }))).toBeNull()
  })
})

describe('dimensionOffsetFor', () => {
  it('returns the signed perpendicular distance of the cursor from p1 -> p2', () => {
    const dimension = makeDimension()

    expect(dimensionOffsetFor(dimension, { x: 60, y: -20 })).toBe(20)
    expect(dimensionOffsetFor(dimension, { x: 60, y: 5 })).toBe(-5)
  })
})

describe('dimensionHitTest', () => {
  it('hits on the dimension line and misses far away', () => {
    const dimension = makeDimension({ offset_in: 12 })

    expect(dimensionHitTest(dimension, { x: 60, y: -12.5 }, 1)).toBe(true)
    expect(dimensionHitTest(dimension, { x: 60, y: 30 }, 1)).toBe(false)
  })
})

describe('labelBounds', () => {
  it('approximates the rendered text box from the baseline anchor', () => {
    const label = makeLabel({ position: { x: 10, y: 20 }, text: 'Room', size_in: 8 })
    const bounds = labelBounds(label)
    const em = labelFontSizeIn(8)

    expect(bounds.minX).toBe(10)
    expect(bounds.minY).toBe(12)
    expect(bounds.maxX).toBeCloseTo(10 + 4 * em * 0.55, 10)
    expect(bounds.maxY).toBeCloseTo(20 + em * 0.25, 10)
  })
})
