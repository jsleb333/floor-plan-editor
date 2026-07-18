import { describe, expect, it } from 'vitest'

import { MAX_TOTAL_PIXELS, PIXELS_PER_FOOT_PRESETS, pngPixelSize } from '@/export/pngExport'

describe('pngPixelSize', () => {
  it('scales real inches to pixels for each preset density', () => {
    // A 10' x 10' content area = 120" x 120".
    expect(pngPixelSize(120, 120, 12)).toEqual({ width: 120, height: 120 })
    expect(pngPixelSize(120, 120, 24)).toEqual({ width: 240, height: 240 })
    expect(pngPixelSize(120, 120, 48)).toEqual({ width: 480, height: 480 })
  })

  it('offers the 12/24/48 presets', () => {
    expect([...PIXELS_PER_FOOT_PRESETS]).toEqual([12, 24, 48])
  })

  it('rounds to at least 1px on each axis', () => {
    expect(pngPixelSize(1, 1, 12)).toEqual({ width: 1, height: 1 })
  })

  it('throws when the total pixel count exceeds the cap', () => {
    const hugeInches = Math.sqrt(MAX_TOTAL_PIXELS) * 12 // px-per-inch is 1 at 12 ppf
    expect(() => pngPixelSize(hugeInches, hugeInches, 48)).toThrow(/exceeds/)
  })

  it('throws on non-positive inputs', () => {
    expect(() => pngPixelSize(0, 100, 24)).toThrow(/positive/)
    expect(() => pngPixelSize(100, -1, 24)).toThrow(/positive/)
    expect(() => pngPixelSize(100, 100, 0)).toThrow(/positive/)
  })
})
