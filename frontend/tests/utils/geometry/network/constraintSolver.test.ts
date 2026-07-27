import { describe, expect, it } from 'vitest'

import type { Joint, Wall } from '@/types/plan'
import { solveConstraints, violations } from '@/utils/geometry'

import { expectPointClose } from '../helpers'
import { wall } from './fixtures'

function solved(walls: Wall[], joints: Joint[], seeds: string[], id: string): Wall {
  const result = solveConstraints(walls, joints, seeds)
  return result.moved.get(id) ?? walls.find((candidate) => candidate.id === id) ?? walls[0]
}

describe('solveConstraints', () => {
  describe('corner', () => {
    const east = wall(
      'east',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      6,
    )
    const south = wall(
      'south',
      [
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      6,
    )
    const corner: Joint = {
      id: 'j',
      kind: 'corner',
      ends: [
        { wall_id: 'east', end: 'end' },
        { wall_id: 'south', end: 'start' },
      ],
      rule: 'miter',
    }

    it('drags the joined end along when its neighbour moves', () => {
      const movedEast = wall(
        'east',
        [
          { x: 0, y: 0 },
          { x: 140, y: 20 },
        ],
        6,
      )

      const result = solved([movedEast, south], [corner], ['east'], 'south')
      expectPointClose(result.vertices[0], { x: 140, y: 20 })
      // Only the joined end follows; the far end stays where the user left it.
      expectPointClose(result.vertices[1], { x: 100, y: 100 })
    })

    it('leaves a satisfied relation untouched', () => {
      const result = solveConstraints([east, south], [corner], ['east'])
      expect(result.moved.size).toBe(0)
      expect(result.unsatisfiedJointIds).toEqual([])
    })

    it('refuses to move a wall with a locked segment and reports it', () => {
      const locked = { ...south, locked_segments: [0] }
      const movedEast = wall(
        'east',
        [
          { x: 0, y: 0 },
          { x: 140, y: 20 },
        ],
        6,
      )

      const result = solveConstraints([movedEast, locked], [corner], ['east'])
      expect(result.moved.size).toBe(0)
      expect(result.unsatisfiedJointIds).toEqual(['j'])
    })
  })

  describe('tee', () => {
    /** 12" host running south on x = 0: surfaces at x = +6 and x = -6. */
    const host = wall(
      'host',
      [
        { x: 0, y: 0 },
        { x: 0, y: 200 },
      ],
      12,
    )
    const partition = wall(
      'partition',
      [
        { x: 6, y: 100 },
        { x: 100, y: 100 },
      ],
      4,
    )
    const tee: Joint = {
      id: 'j',
      kind: 'tee',
      end: { wall_id: 'partition', end: 'start' },
      host: { wall_id: 'host', segment_index: 0 },
    }

    it('follows the host surface when the host thickens', () => {
      // A 12" host becoming 24" moves its surface from x = 6 to x = 12; the
      // partition has to follow or it would float inside the body.
      const thicker = { ...host, thickness_in: 24 }

      const result = solved([thicker, partition], [tee], ['host'], 'partition')
      expectPointClose(result.vertices[0], { x: 12, y: 100 })
      expectPointClose(result.vertices[1], { x: 100, y: 100 })
    })

    it('keeps an endpoint dragged along the host where the user put it', () => {
      // Dragged down the host and 2" off its surface: the along-host move stands,
      // only the drift across the surface is corrected.
      const dragged = wall(
        'partition',
        [
          { x: 8, y: 40 },
          { x: 100, y: 40 },
        ],
        4,
      )

      const result = solved([host, dragged], [tee], ['host'], 'partition')
      expectPointClose(result.vertices[0], { x: 6, y: 40 })
    })
  })

  describe('flush', () => {
    /** 12" shell running south on x = 0, its left surface at x = +6. */
    const shell = wall(
      'shell',
      [
        { x: 0, y: 0 },
        { x: 0, y: 200 },
      ],
      12,
    )
    /** 4" partition continuing it, spine offset so both left surfaces are x = 6. */
    const partition = wall(
      'partition',
      [
        { x: 4, y: 200 },
        { x: 4, y: 320 },
      ],
      4,
    )
    const flush: Joint = {
      id: 'j',
      kind: 'flush',
      a: { ref: { wall_id: 'shell', end: 'end' }, side: 'left' },
      b: { ref: { wall_id: 'partition', end: 'start' }, side: 'left' },
    }

    it('keeps the surfaces shared when the partition changes thickness', () => {
      // An 8" partition needs its spine at x = 2 for its left surface to stay at
      // x = 6; the thickness change alone would have left it at x = 4.
      const thicker = { ...partition, thickness_in: 8 }

      const result = solved([shell, thicker], [flush], ['shell'], 'partition')
      expectPointClose(result.vertices[0], { x: 2, y: 200 })
      expectPointClose(result.vertices[1], { x: 2, y: 320 })
    })

    it('keeps the surfaces shared when the shell changes thickness', () => {
      // A 24" shell puts its left surface at x = 12, so the 4" partition slides
      // to x = 10 — the whole wall, since only translating one end would rotate
      // it out of the relation.
      const thicker = { ...shell, thickness_in: 24 }

      const result = solved([thicker, partition], [flush], ['shell'], 'partition')
      expectPointClose(result.vertices[0], { x: 10, y: 200 })
      expectPointClose(result.vertices[1], { x: 10, y: 320 })
    })

    it('reports a relation it cannot satisfy', () => {
      // Turned across the shell: no sideways slide makes the surfaces collinear.
      const turned = wall(
        'partition',
        [
          { x: 4, y: 200 },
          { x: 120, y: 260 },
        ],
        4,
      )

      expect(violations([shell, turned], [flush])).toEqual(['j'])
    })
  })

  it('propagates through a chain of relations', () => {
    const b = wall(
      'b',
      [
        { x: 100, y: 0 },
        { x: 200, y: 0 },
      ],
      6,
    )
    const c = wall(
      'c',
      [
        { x: 200, y: 0 },
        { x: 300, y: 0 },
      ],
      6,
    )
    const joints: Joint[] = [
      {
        id: 'ab',
        kind: 'corner',
        ends: [
          { wall_id: 'a', end: 'end' },
          { wall_id: 'b', end: 'start' },
        ],
        rule: 'miter',
      },
      {
        id: 'bc',
        kind: 'corner',
        ends: [
          { wall_id: 'b', end: 'end' },
          { wall_id: 'c', end: 'start' },
        ],
        rule: 'miter',
      },
    ]
    const movedA = wall(
      'a',
      [
        { x: 0, y: 0 },
        { x: 100, y: 40 },
      ],
      6,
    )

    const result = solveConstraints([movedA, b, c], joints, ['a'])
    // b's start follows a, and c's start then follows b's end — which b did not
    // move, so c stays put. What matters is that the pass reaches it at all.
    expect(result.moved.has('b')).toBe(true)
    expect(result.unsatisfiedJointIds).toEqual([])
  })
})
