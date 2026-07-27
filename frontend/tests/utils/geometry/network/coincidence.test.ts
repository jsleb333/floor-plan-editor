import { describe, expect, it } from 'vitest'

import { deriveJoints, resolveWallNetwork } from '@/utils/geometry'

import { expectPointClose } from '../helpers'
import { resolvedEnd, wall } from './fixtures'

/** 12" shell running south on x = 0: surfaces at x = +6 (left) and x = -6 (right). */
const SHELL = wall(
  'shell',
  [
    { x: 0, y: 0 },
    { x: 0, y: 200 },
  ],
  12,
)

describe('deriveJoints', () => {
  it('reads coincident ends as a corner', () => {
    const a = wall(
      'a',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      6,
    )
    const b = wall(
      'b',
      [
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      6,
    )

    expect(deriveJoints([a, b])).toEqual([
      {
        id: 'corner:a:end|b:start',
        kind: 'corner',
        ends: [
          { wall_id: 'a', end: 'end' },
          { wall_id: 'b', end: 'start' },
        ],
        rule: 'miter',
      },
    ])
  })

  it('prefers a corner over a tee when an end lands on the host end point', () => {
    const a = wall(
      'a',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      6,
    )
    const b = wall(
      'b',
      [
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      6,
    )

    const kinds = deriveJoints([a, b]).map((joint) => joint.kind)
    expect(kinds).toEqual(['corner'])
  })

  it('reads an end landing on a body as a tee, naming the segment it met', () => {
    const partition = wall(
      'partition',
      [
        { x: 6, y: 100 },
        { x: 100, y: 100 },
      ],
      4,
    )

    expect(deriveJoints([SHELL, partition])).toEqual([
      {
        id: 'tee:partition:start>shell#0',
        kind: 'tee',
        end: { wall_id: 'partition', end: 'start' },
        host: { wall_id: 'shell', segment_index: 0 },
      },
    ])
  })

  it('reads an offset continuation with collinear surfaces as flush', () => {
    // 4" partition continuing the 12" shell with their left surfaces shared.
    const partition = wall(
      'partition',
      [
        { x: 4, y: 200 },
        { x: 4, y: 320 },
      ],
      4,
    )

    expect(deriveJoints([SHELL, partition])).toEqual([
      {
        id: 'flush:partition:start|shell:end',
        kind: 'flush',
        a: { ref: { wall_id: 'shell', end: 'end' }, side: 'left' },
        b: { ref: { wall_id: 'partition', end: 'start' }, side: 'left' },
      },
    ])
  })

  it('leaves unrelated walls unjoined', () => {
    const loose = wall(
      'loose',
      [
        { x: 500, y: 500 },
        { x: 600, y: 500 },
      ],
      6,
    )
    expect(deriveJoints([SHELL, loose])).toEqual([])
  })

  it('derives the same joints from an unchanged document', () => {
    const partition = wall(
      'partition',
      [
        { x: 6, y: 100 },
        { x: 100, y: 100 },
      ],
      4,
    )
    const walls = [SHELL, partition]
    expect(deriveJoints(walls)).toEqual(deriveJoints(walls))
  })

  it('produces joints the resolver can use, so a plan with no records heals', () => {
    const a = wall(
      'a',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      6,
    )
    const b = wall(
      'b',
      [
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      6,
    )

    const network = resolveWallNetwork([a, b], deriveJoints([a, b]))
    expectPointClose(resolvedEnd(network, 'a', 'end').left, { x: 103, y: -3 })
    expectPointClose(resolvedEnd(network, 'b', 'start').left, { x: 103, y: -3 })
  })
})
