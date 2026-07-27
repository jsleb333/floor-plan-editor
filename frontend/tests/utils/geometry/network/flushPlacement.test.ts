import { describe, expect, it } from 'vitest'

import {
  flushSpinePoint,
  resolveWallNetwork,
  spineToSurface,
  surfaceAnchor,
} from '@/utils/geometry'

import { expectPointClose } from '../helpers'
import { resolvedWall, wall } from './fixtures'

/** 12" shell running south on x = 0: surfaces at x = +6 (left) and x = -6 (right). */
const SHELL = wall(
  'shell',
  [
    { x: 0, y: 0 },
    { x: 0, y: 200 },
  ],
  12,
)

function shellAnchor(side: 'left' | 'right', end: 'start' | 'end') {
  const network = resolveWallNetwork([SHELL], [])
  const anchor = surfaceAnchor(resolvedWall(network, 'shell'), side, end)
  if (!anchor) throw new Error('the shell has no such surface terminus')
  return anchor
}

describe('spineToSurface', () => {
  it('measures from the spine to the named surface for each reference side', () => {
    expect(spineToSurface(12, 'center', 'left')).toBe(6)
    expect(spineToSurface(12, 'center', 'right')).toBe(6)
    // A wall drawn on its left face has that face ON the spine.
    expect(spineToSurface(12, 'left', 'left')).toBe(0)
    expect(spineToSurface(12, 'left', 'right')).toBe(12)
    expect(spineToSurface(12, 'right', 'left')).toBe(12)
    expect(spineToSurface(12, 'right', 'right')).toBe(0)
  })
})

describe('surfaceAnchor', () => {
  it('points its normal into the wall body', () => {
    expectPointClose(shellAnchor('left', 'end').corner, { x: 6, y: 200 })
    expectPointClose(shellAnchor('left', 'end').inward, { x: -1, y: 0 })
    expectPointClose(shellAnchor('right', 'end').corner, { x: -6, y: 200 })
    expectPointClose(shellAnchor('right', 'end').inward, { x: 1, y: 0 })
  })
})

describe('flushSpinePoint', () => {
  it('offsets a thinner wall so its own surface continues the captured one', () => {
    // A 4" partition continuing the 12" shell south: its spine sits 2" inside
    // the shared surface, so the two surfaces are one line at x = 6.
    const placement = flushSpinePoint(shellAnchor('left', 'end'), { x: 0, y: 1 }, 4, 'center')

    expect(placement).not.toBeNull()
    expectPointClose(placement?.point ?? { x: 0, y: 0 }, { x: 4, y: 200 })
    expect(placement?.side).toBe('left')
  })

  it('names the other surface when the wall runs the other way', () => {
    const placement = flushSpinePoint(shellAnchor('left', 'end'), { x: 0, y: -1 }, 4, 'center')

    expectPointClose(placement?.point ?? { x: 0, y: 0 }, { x: 4, y: 200 })
    expect(placement?.side).toBe('right')
  })

  it('puts the spine ON the surface for a wall referenced to that side', () => {
    const placement = flushSpinePoint(shellAnchor('left', 'end'), { x: 0, y: 1 }, 4, 'left')

    expectPointClose(placement?.point ?? { x: 0, y: 0 }, { x: 6, y: 200 })
    expect(placement?.side).toBe('left')
  })

  it('declines a direction that is not a continuation', () => {
    // Perpendicular is a T and any other angle is a corner; neither shares a surface.
    expect(flushSpinePoint(shellAnchor('left', 'end'), { x: 1, y: 0 }, 4, 'center')).toBeNull()
    expect(flushSpinePoint(shellAnchor('left', 'end'), { x: 1, y: 1 }, 4, 'center')).toBeNull()
    expect(flushSpinePoint(shellAnchor('left', 'end'), { x: 0, y: 0 }, 4, 'center')).toBeNull()
  })

  it('produces geometry the resolver reports as satisfied', () => {
    const placement = flushSpinePoint(shellAnchor('left', 'end'), { x: 0, y: 1 }, 4, 'center')
    const partition = wall(
      'partition',
      [placement?.point ?? { x: 0, y: 0 }, { x: placement?.point.x ?? 0, y: 320 }],
      4,
    )
    const network = resolveWallNetwork(
      [SHELL, partition],
      [
        {
          id: 'j',
          kind: 'flush',
          a: { ref: { wall_id: 'shell', end: 'end' }, side: 'left' },
          b: { ref: { wall_id: 'partition', end: 'start' }, side: placement?.side ?? 'left' },
        },
      ],
    )

    // The whole point: the two surfaces resolve to one line, with no complaint
    // from the constraint check.
    expect(network.unsatisfiedJointIds).toEqual([])
    expectPointClose(resolvedWall(network, 'shell').ends.end?.left ?? { x: 0, y: 0 }, {
      x: 6,
      y: 200,
    })
    expectPointClose(resolvedWall(network, 'partition').ends.start?.left ?? { x: 0, y: 0 }, {
      x: 6,
      y: 200,
    })
  })
})
