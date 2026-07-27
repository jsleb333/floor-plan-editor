import { describe, expect, it } from 'vitest'

import { anchorAlignFree, collectAlignmentAnchors } from '@/utils/geometry'
import type { NetworkAnchor } from '@/utils/geometry'

const ANCHORS: readonly NetworkAnchor[] = [
  { point: { x: 6, y: 0 }, kind: 'face-corner', wallId: 'shell' },
  { point: { x: 0, y: 0 }, kind: 'spine-end', wallId: 'shell' },
  { point: { x: 3, y: 0 }, kind: 'joint', wallId: 'shell' },
  { point: { x: 500, y: 500 }, kind: 'face-corner', wallId: 'far' },
]

describe('collectAlignmentAnchors', () => {
  it('keeps only the anchors within the capture radius', () => {
    const near = collectAlignmentAnchors(ANCHORS, { x: 0, y: 50 }, 100)
    expect(near.map((anchor) => anchor.kind)).toEqual(['face-corner', 'spine-end', 'joint'])
  })
})

describe('anchorAlignFree ranking (spec S1e)', () => {
  it('prefers a visible surface corner to a spine end and a T centre', () => {
    // Three anchors offer three vertical lines. The cursor is nearest the T
    // centre's line and farthest from the corner's, and the corner still wins:
    // a guide exists to line up with what is on screen.
    const result = anchorAlignFree({ x: 3.5, y: 50 }, ANCHORS, 5)

    expect(result?.point.x).toBeCloseTo(6)
    expect(result?.guides[0].kind).toBe('face-corner')
  })

  it('prefers a spine end to a T centre when no corner is in range', () => {
    const withoutCorners = ANCHORS.filter((anchor) => anchor.kind !== 'face-corner')
    const result = anchorAlignFree({ x: 1.6, y: 50 }, withoutCorners, 5)

    expect(result?.point.x).toBeCloseTo(0)
    expect(result?.guides[0].kind).toBe('spine-end')
  })
})
