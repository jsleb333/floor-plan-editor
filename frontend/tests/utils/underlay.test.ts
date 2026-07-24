import { describe, expect, it } from 'vitest'

import type { UnderlayTransform } from '@/types/plan'
import {
  DEFAULT_UNDERLAY_SPAN_IN,
  calibrationScale,
  initialUnderlayTransform,
  normalizeDegrees,
  rotatedAboutCenter,
  scaledAboutAnchor,
  underlayContains,
  underlayToWorld,
  worldToUnderlayPixel,
} from '@/utils/underlay'

const TRANSFORM: UnderlayTransform = {
  origin: { x: 100, y: 50 },
  rotation_deg: 30,
  scale: 0.5,
}

function closeTo(actual: { x: number; y: number }, expected: { x: number; y: number }): void {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
}

describe('normalizeDegrees', () => {
  it('wraps any angle into (-180, 180]', () => {
    expect(normalizeDegrees(0)).toBe(0)
    expect(normalizeDegrees(45)).toBe(45)
    expect(normalizeDegrees(190)).toBe(-170)
    expect(normalizeDegrees(-190)).toBe(170)
    expect(normalizeDegrees(360)).toBe(0)
    expect(normalizeDegrees(540)).toBe(180)
  })

  it('maps both boundary angles to +180', () => {
    expect(normalizeDegrees(180)).toBe(180)
    expect(normalizeDegrees(-180)).toBe(180)
  })
})

describe('calibrationScale', () => {
  it('returns the scale that makes the reference segment measure its known length', () => {
    // A segment spanning 60 world inches under scale 0.5 covers 120 image pixels;
    // if those 120 pixels really mean 240", the scale must become 2 in/px.
    expect(calibrationScale(60, 0.5, 240)).toBeCloseTo(2, 9)
  })

  it('is equivalent to knownLength divided by the segment pixel count', () => {
    const currentScale = 0.5
    const segmentWorldLen = 60
    const knownLen = 240
    const pixelCount = segmentWorldLen / currentScale
    expect(calibrationScale(segmentWorldLen, currentScale, knownLen)).toBeCloseTo(
      knownLen / pixelCount,
      9,
    )
  })
})

describe('scaledAboutAnchor', () => {
  it('keeps the image pixel under the anchor fixed in world space', () => {
    const anchor = { x: 130, y: 80 }
    const pixelUnderAnchor = worldToUnderlayPixel(TRANSFORM, anchor)
    const rescaled = scaledAboutAnchor(TRANSFORM, anchor, 2)

    expect(rescaled.scale).toBe(2)
    expect(rescaled.rotation_deg).toBe(TRANSFORM.rotation_deg)
    // The same image pixel still lands exactly on the anchor after rescaling.
    closeTo(underlayToWorld(rescaled, pixelUnderAnchor), anchor)
  })

  it('is a no-op when the scale is unchanged', () => {
    const rescaled = scaledAboutAnchor(TRANSFORM, { x: 200, y: 10 }, TRANSFORM.scale)
    closeTo(rescaled.origin, TRANSFORM.origin)
    expect(rescaled.scale).toBe(TRANSFORM.scale)
  })
})

describe('rotatedAboutCenter', () => {
  it('keeps the image centre fixed in world space', () => {
    const size = { width: 200, height: 120 }
    const centreBefore = underlayToWorld(TRANSFORM, { x: size.width / 2, y: size.height / 2 })
    const rotated = rotatedAboutCenter(TRANSFORM, size, 75)

    expect(rotated.rotation_deg).toBe(75)
    expect(rotated.scale).toBe(TRANSFORM.scale)
    const centreAfter = underlayToWorld(rotated, { x: size.width / 2, y: size.height / 2 })
    closeTo(centreAfter, centreBefore)
  })
})

describe('initialUnderlayTransform', () => {
  it('centres the image on the given point and spans the default width', () => {
    const size = { width: 800, height: 600 }
    const centre = { x: 240, y: 120 }
    const transform = initialUnderlayTransform(size, centre)

    expect(transform.rotation_deg).toBe(0)
    expect(transform.scale).toBeCloseTo(DEFAULT_UNDERLAY_SPAN_IN / size.width, 9)
    // Top-left origin sits half the scaled size up-and-left of the centre.
    closeTo(underlayToWorld(transform, { x: size.width / 2, y: size.height / 2 }), centre)
    expect(size.width * transform.scale).toBeCloseTo(DEFAULT_UNDERLAY_SPAN_IN, 9)
  })
})

describe('underlayContains', () => {
  const size = { width: 200, height: 100 }

  it('is true for a world point over the image rectangle and false outside it', () => {
    const inside = underlayToWorld(TRANSFORM, { x: 100, y: 50 })
    const outside = underlayToWorld(TRANSFORM, { x: 260, y: 50 })
    expect(underlayContains(TRANSFORM, size, inside)).toBe(true)
    expect(underlayContains(TRANSFORM, size, outside)).toBe(false)
  })
})
