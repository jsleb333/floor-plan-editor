import { describe, expect, it } from 'vitest'

import type { Joint, Point } from '@/types/plan'
import {
  geometryInputOf,
  offsetPolyline,
  pointInRings,
  resolveWallNetwork,
  wallFacePolylines,
} from '@/utils/geometry'

import { expectPointClose, expectPointsClose } from '../helpers'
import { resolvedEnd, resolvedWall, wall } from './fixtures'

const SQRT2 = Math.SQRT2

/** A corner between the END of the first wall and the START of the second. */
function corner(id: string, first: string, second: string): Joint {
  return {
    id,
    kind: 'corner',
    ends: [
      { wall_id: first, end: 'end' },
      { wall_id: second, end: 'start' },
    ],
    rule: 'miter',
  }
}

const EAST = wall(
  'east',
  [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  6,
)
const SOUTH = wall(
  'south',
  [
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ],
  6,
)

describe('resolveWallNetwork', () => {
  it('leaves an unjoined wall exactly as its own faces, so consumers can migrate one at a time', () => {
    const only = wall(
      'only',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      6,
    )
    const faces = wallFacePolylines(geometryInputOf(only))

    const resolved = resolvedWall(resolveWallNetwork([only], []), 'only')
    expectPointsClose(resolved.left, faces.left)
    expectPointsClose(resolved.right, faces.right)
  })

  describe('corner', () => {
    it('mitres two walls exactly as one chain of the same shape', () => {
      const network = resolveWallNetwork([EAST, SOUTH], [corner('j', 'east', 'south')])

      // The chain the user could have drawn instead, offset by the same faces.
      const chain = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ]
      const chainLeft = offsetPolyline(chain, 3)
      const chainRight = offsetPolyline(chain, -3)

      expectPointsClose(resolvedWall(network, 'east').left, [chainLeft[0], chainLeft[1]])
      expectPointsClose(resolvedWall(network, 'south').left, [chainLeft[1], chainLeft[2]])
      expectPointsClose(resolvedWall(network, 'east').right, [chainRight[0], chainRight[1]])
      expectPointsClose(resolvedWall(network, 'south').right, [chainRight[1], chainRight[2]])
    })

    it('mitres walls of different thicknesses to shared corner points', () => {
      const shell = wall(
        'shell',
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        12,
      )
      const partition = wall(
        'partition',
        [
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
        4,
      )
      const network = resolveWallNetwork([shell, partition], [corner('j', 'shell', 'partition')])

      // The 12" top surface runs out to the 4" wall's outer surface and the inner
      // corner closes on the other pair: no gap, no overlap, one continuous body.
      expectPointClose(resolvedEnd(network, 'shell', 'end').left, { x: 102, y: -6 })
      expectPointClose(resolvedEnd(network, 'partition', 'start').left, { x: 102, y: -6 })
      expectPointClose(resolvedEnd(network, 'shell', 'end').right, { x: 98, y: 6 })
      expectPointClose(resolvedEnd(network, 'partition', 'start').right, { x: 98, y: 6 })
    })

    it('reports a wedge to patch when the mitre is too acute to close', () => {
      const doubling = wall(
        'doubling',
        [
          { x: 100, y: 0 },
          { x: 4, y: 6 },
        ],
        12,
      )
      const thick = wall(
        'thick',
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        12,
      )
      const network = resolveWallNetwork([thick, doubling], [corner('j', 'thick', 'doubling')])

      expect(network.gaps.length).toBeGreaterThan(0)
      expect(network.gaps[0].jointId).toBe('j')
    })
  })

  describe('tee', () => {
    const host = wall(
      'host',
      [
        { x: 0, y: 0 },
        { x: 0, y: 200 },
      ],
      12,
    )
    const tee: Joint = {
      id: 'j',
      kind: 'tee',
      end: { wall_id: 'partition', end: 'start' },
      host: { wall_id: 'host', segment_index: 0 },
    }

    it('butts a partition against the host surface rather than its spine', () => {
      const partition = wall(
        'partition',
        [
          { x: 0, y: 100 },
          { x: 100, y: 100 },
        ],
        4,
      )
      const network = resolveWallNetwork([host, partition], [tee])
      const resolved = resolvedWall(network, 'partition')

      expectPointClose(resolved.left[0], { x: 6, y: 98 })
      expectPointClose(resolved.right[0], { x: 6, y: 102 })
      expectPointClose(resolvedEnd(network, 'partition', 'start').spine, { x: 6, y: 100 })

      // The invariant the reported seams violated: no outline vertex of one wall
      // may sit inside another wall's body.
      const hostRings = resolvedWall(network, 'host').rings
      for (const ring of resolved.rings) {
        for (const vertex of ring) expect(pointInRings(vertex, hostRings)).toBe(false)
      }
    })

    it('cuts an angled approach parallel to the host surface, not square to the partition', () => {
      const partition = wall(
        'partition',
        [
          { x: 0, y: 100 },
          { x: 100, y: 200 },
        ],
        4,
      )
      const resolved = resolvedWall(resolveWallNetwork([host, partition], [tee]), 'partition')

      // Both surfaces terminate ON the host surface (x = 6). A cap square to the
      // partition could not put both there, which is what left a wedge before.
      expect(resolved.left[0].x).toBeCloseTo(6, 9)
      expect(resolved.right[0].x).toBeCloseTo(6, 9)
      expectPointClose(resolved.left[0], { x: 6, y: 106 - 2 * SQRT2 })
      expectPointClose(resolved.right[0], { x: 6, y: 106 + 2 * SQRT2 })
    })

    it('offers the T centre on the host spine as a joint anchor', () => {
      const partition = wall(
        'partition',
        [
          { x: 6, y: 100 },
          { x: 100, y: 100 },
        ],
        4,
      )
      const network = resolveWallNetwork([host, partition], [tee])

      // No wall has a vertex here once the partition is stored honestly, so this
      // anchor can only come from the graph (docs/WALL_NETWORK.md §8).
      const jointAnchors = network.anchors.filter((anchor) => anchor.kind === 'joint')
      expect(jointAnchors).toHaveLength(1)
      expectPointClose(jointAnchors[0].point, { x: 0, y: 100 })
    })
  })

  describe('flush', () => {
    const shell = wall(
      'shell',
      [
        { x: 0, y: 0 },
        { x: 0, y: 200 },
      ],
      12,
    )
    const flush: Joint = {
      id: 'j',
      kind: 'flush',
      a: { ref: { wall_id: 'shell', end: 'end' }, side: 'left' },
      b: { ref: { wall_id: 'partition', end: 'start' }, side: 'left' },
    }

    it('reads as one wall when the thinner partition sits on the shared surface', () => {
      // A 4" partition continuing a 12" shell, offset so their left surfaces
      // coincide: the reported case, correct by construction.
      const partition = wall(
        'partition',
        [
          { x: 4, y: 200 },
          { x: 4, y: 320 },
        ],
        4,
      )
      const network = resolveWallNetwork([shell, partition], [flush])

      expect(network.unsatisfiedJointIds).toEqual([])
      const shellEnd = resolvedEnd(network, 'shell', 'end')
      const partitionStart = resolvedEnd(network, 'partition', 'start')
      expectPointClose(shellEnd.left, partitionStart.left)
      expectPointClose(shellEnd.left, { x: 6, y: 200 })

      // The whole thickness difference steps off the other side.
      expectPointClose(shellEnd.right, { x: -6, y: 200 })
      expectPointClose(partitionStart.right, { x: 2, y: 200 })
    })

    it('reports the joint unsatisfied when the partition sits on the shell spine instead', () => {
      // What snapping produces today: centred on the shell's spine, so the
      // surfaces miss each other by half the thickness difference.
      const partition = wall(
        'partition',
        [
          { x: 0, y: 200 },
          { x: 0, y: 320 },
        ],
        4,
      )
      const network = resolveWallNetwork([shell, partition], [flush])

      expect(network.unsatisfiedJointIds).toEqual(['j'])
      const shellEnd = resolvedEnd(network, 'shell', 'end')
      const partitionStart = resolvedEnd(network, 'partition', 'start')
      expect(shellEnd.left.x).not.toBeCloseTo(partitionStart.left.x, 6)
    })
  })

  describe('bookkeeping', () => {
    it('groups joined walls into one component and leaves others alone', () => {
      const loose = wall(
        'loose',
        [
          { x: 500, y: 500 },
          { x: 600, y: 500 },
        ],
        6,
      )
      const network = resolveWallNetwork([EAST, SOUTH, loose], [corner('j', 'east', 'south')])

      expect(network.components.map((group) => [...group].sort())).toEqual([
        ['east', 'south'],
        ['loose'],
      ])
    })

    it('reports a joint naming an absent wall and resolves the rest', () => {
      const network = resolveWallNetwork([EAST], [corner('j', 'east', 'ghost')])

      expect(network.danglingJointIds).toEqual(['j'])
      expect(network.walls.get('east')).toBeDefined()
    })

    it('collapses a shared mitre into one face-corner anchor', () => {
      const network = resolveWallNetwork([EAST, SOUTH], [corner('j', 'east', 'south')])

      const mitre: Point = { x: 103, y: -3 }
      const atMitre = network.anchors.filter(
        (anchor) => Math.hypot(anchor.point.x - mitre.x, anchor.point.y - mitre.y) < 1e-6,
      )
      expect(atMitre).toHaveLength(1)
      expect(atMitre[0].kind).toBe('face-corner')
    })
  })
})
