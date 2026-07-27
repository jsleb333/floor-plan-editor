import { describe, expect, it } from 'vitest'

import { MAX_PRESET_LIST_SIZE, PRESET_LIST_NAMES, resolve, withValue } from '@/utils/presetLists'
import type { PlanDocument } from '@/types/plan'

function documentWith(presetLists: Record<string, number[]>): Pick<PlanDocument, 'preset_lists'> {
  return { preset_lists: presetLists }
}

describe('resolve', () => {
  it('returns the built-in defaults when the document has no entry for the name', () => {
    // 48 and 60 are the closet widths the wide door styles are drawn at (spec S4).
    expect(resolve(PRESET_LIST_NAMES.doorWidth, documentWith({}))).toEqual([
      24, 28, 30, 32, 36, 48, 60,
    ])
    expect(resolve(PRESET_LIST_NAMES.windowWidth, documentWith({}))).toEqual([24, 36, 48, 60, 72])
    expect(resolve(PRESET_LIST_NAMES.stairsWidth, documentWith({}))).toEqual([30, 36, 42, 48])
  })

  it('returns the document’s own list when present, even if empty', () => {
    const document = documentWith({ door_width: [30, 54] })

    expect(resolve(PRESET_LIST_NAMES.doorWidth, document)).toEqual([30, 54])
  })

  it('falls back to the built-in defaults when the document is null or undefined', () => {
    expect(resolve(PRESET_LIST_NAMES.stairsWidth, null)).toEqual([30, 36, 42, 48])
    expect(resolve(PRESET_LIST_NAMES.stairsWidth, undefined)).toEqual([30, 36, 42, 48])
  })
})

describe('withValue', () => {
  it('inserts a new value in ascending order without mutating the input', () => {
    const list = [24, 28, 30, 32, 36]

    const next = withValue(list, 54)

    expect(next).toEqual([24, 28, 30, 32, 36, 54])
    expect(list).toEqual([24, 28, 30, 32, 36])
  })

  it('de-duplicates a value already present within tolerance', () => {
    const next = withValue([24, 28, 30, 32, 36], 30.0000000001)

    expect(next).toEqual([24, 28, 30, 32, 36])
  })

  it('replaces a stale entry rather than growing past the size cap by dropping the value farthest from the new one', () => {
    const list = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    expect(list.length).toBe(MAX_PRESET_LIST_SIZE)

    const next = withValue(list, 42)

    expect(next.length).toBe(MAX_PRESET_LIST_SIZE)
    expect(next).toContain(42)
    // 100 is farthest from 42 (distance 58) among the existing entries.
    expect(next).not.toContain(100)
  })

  it('keeps the newly added value even when it is itself the most extreme entry', () => {
    const list = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

    const next = withValue(list, 1000)

    expect(next.length).toBe(MAX_PRESET_LIST_SIZE)
    expect(next).toContain(1000)
    // 10 is farthest from 1000 among the pre-existing entries.
    expect(next).not.toContain(10)
  })
})
