import { describe, it } from 'vitest'

import { constrainedVertexPosition } from '@/utils/geometry'
import { expectPointClose } from './helpers'

describe('constrainedVertexPosition', () => {
  it('snaps to the intersection of allowed-direction lines through both neighbours', () => {
    // Horizontal line through prev (y=0) meets vertical line through next (x=100).
    const position = constrainedVertexPosition({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 98, y: 2 })
    expectPointClose(position, { x: 100, y: 0 })
  })

  it('picks a diagonal intersection when the cursor favours it', () => {
    // Prev horizontal (y=0) meets the anti-diagonal through next (y = 200 - x) at (200, 0):
    // the prev segment stays at 0° and the next segment lands on 45°.
    const position = constrainedVertexPosition(
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 160, y: -10 },
    )
    expectPointClose(position, { x: 200, y: 0 })
  })

  it('projects onto the nearest allowed line through the single neighbour at a chain end', () => {
    const horizontal = constrainedVertexPosition({ x: 0, y: 0 }, null, { x: 80, y: 3 })
    expectPointClose(horizontal, { x: 80, y: 0 })

    const diagonal = constrainedVertexPosition(null, { x: 0, y: 0 }, { x: 50, y: 49 })
    expectPointClose(diagonal, { x: 49.5, y: 49.5 })
  })

  it('returns the cursor unchanged with no neighbours', () => {
    expectPointClose(constrainedVertexPosition(null, null, { x: 7, y: 9 }), { x: 7, y: 9 })
  })
})
