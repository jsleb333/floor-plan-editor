import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { Ref } from 'vue'

import { useSnapping } from '@/composables/useSnapping'
import type { SnapChainContext, UseSnappingReturn } from '@/composables/useSnapping'
import type { Joint, Wall } from '@/types/plan'
import { resolveWallNetwork } from '@/utils/geometry'
import { makeWall } from '../helpers/planFactory'

interface SnappingOverrides {
  grid?: boolean
  angle?: boolean
  walls?: boolean
  pixelsPerInch?: number
  /** Supplies the resolved network, which is what makes wall surfaces snappable. */
  surfaces?: boolean
}

/** Snap engine over the given walls; pixelsPerInch defaults to 1 (threshold = 10"). */
function makeSnapping(
  walls: Wall[] = [],
  overrides: SnappingOverrides = {},
  joints: Joint[] = [],
): UseSnappingReturn {
  const wallsRef: Ref<readonly Wall[]> = ref(walls)
  return useSnapping({
    walls: wallsRef,
    joints: ref<readonly Joint[]>(joints),
    network: overrides.surfaces === true ? ref(resolveWallNetwork(walls, joints)) : undefined,
    pixelsPerInch: ref(overrides.pixelsPerInch ?? 1),
    settings: {
      grid: ref(overrides.grid ?? true),
      angle: ref(overrides.angle ?? true),
      walls: ref(overrides.walls ?? true),
    },
  })
}

/** The 'attached' wall's end sits on 'host', which is what makes it a junction anchor. */
const ATTACHED_TEE: Joint = {
  id: 'tee-attached',
  kind: 'tee',
  end: { wall_id: 'attached', end: 'end' },
  host: { wall_id: 'host', segment_index: 0 },
}

function chain(start: [number, number], last: [number, number], count: number): SnapChainContext {
  return {
    start: { x: start[0], y: start[1] },
    last: { x: last[0], y: last[1] },
    vertexCount: count,
  }
}

describe('useSnapping resolve', () => {
  it('close-loop snap wins over an endpoint at the same spot when the chain has 3+ vertices', () => {
    const snapping = makeSnapping([
      makeWall({
        vertices: [
          { x: 0, y: 0 },
          { x: 0, y: 120 },
        ],
      }),
    ])
    const result = snapping.resolve({ x: 1, y: 1 }, chain([0, 0], [100, 100], 3), false)
    expect(result.marker).toBe('close')
    expect(result.point).toEqual({ x: 0, y: 0 })
  })

  it('close-loop snap is not offered with fewer than 3 chain vertices', () => {
    const snapping = makeSnapping()
    const result = snapping.resolve({ x: 1, y: 1 }, chain([0, 0], [100, 100], 2), false)
    expect(result.marker).not.toBe('close')
  })

  it('endpoint snap wins over midpoint and projection when all are in range', () => {
    const wall = makeWall({
      vertices: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
      ],
    })
    const snapping = makeSnapping([wall])
    const result = snapping.resolve({ x: 2, y: 3 }, null, false)
    expect(result.marker).toBe('endpoint')
    expect(result.point).toEqual({ x: 0, y: 0 })
  })

  it('midpoint snap wins over projection when no endpoint is in range', () => {
    const wall = makeWall({
      vertices: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
      ],
    })
    const snapping = makeSnapping([wall])
    const result = snapping.resolve({ x: 58, y: 4 }, null, false)
    expect(result.marker).toBe('midpoint')
    expect(result.point).toEqual({ x: 60, y: 0 })
  })

  it('projection snap returns the host attachment with t in inches along the segment', () => {
    const wall = makeWall({
      id: 'host',
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 240 },
      ],
    })
    const snapping = makeSnapping([wall])
    const result = snapping.resolve({ x: 2, y: 100 }, null, false)
    expect(result.marker).toBe('projection')
    expect(result.point.x).toBeCloseTo(0)
    expect(result.point.y).toBeCloseTo(100)
    expect(result.attachment).toEqual({ wallId: 'host', segmentIndex: 0, tIn: 100 })
  })

  it('projection snap covers the closing segment of a closed wall', () => {
    const wall = makeWall({
      closed: true,
      vertices: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: 120 },
        { x: 0, y: 120 },
      ],
    })
    const snapping = makeSnapping([wall])
    // Near the wrap-around segment (0,120) -> (0,0), away from vertices and midpoints.
    const result = snapping.resolve({ x: 3, y: 40 }, null, false)
    expect(result.marker).toBe('projection')
    expect(result.point.x).toBeCloseTo(0)
    expect(result.point.y).toBeCloseTo(40)
    expect(result.attachment?.segmentIndex).toBe(3)
  })

  it('grid snap rounds a free first vertex to the 3-inch grid', () => {
    const snapping = makeSnapping()
    const result = snapping.resolve({ x: 50, y: 49 }, null, false)
    expect(result.point).toEqual({ x: 51, y: 48 })
    expect(result.marker).toBeNull()
  })

  it('angle snap constrains the pending segment to a global direction with a guide, grid-rounding the length', () => {
    const snapping = makeSnapping()
    const result = snapping.resolve({ x: 100, y: 6 }, chain([0, 0], [0, 0], 1), false)
    expect(result.point.x).toBeCloseTo(99)
    expect(result.point.y).toBeCloseTo(0)
    expect(result.guide).not.toBeNull()
    expect(result.guide?.dir).toEqual({ x: 1, y: 0 })
  })

  it('projection snap lands where the constrained ray crosses the wall while drawing', () => {
    const host = makeWall({
      id: 'host',
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 240 },
      ],
    })
    const snapping = makeSnapping([host])
    // Drawing west from (100,100): the cursor sits 2" below the ray, but the
    // landing point must stay on it — not follow the cursor along the wall.
    const result = snapping.resolve({ x: 3, y: 98 }, chain([300, 300], [100, 100], 2), false)
    expect(result.marker).toBe('projection')
    expect(result.point.x).toBeCloseTo(0)
    expect(result.point.y).toBeCloseTo(100)
    expect(result.attachment?.tIn).toBeCloseTo(100)
    expect(result.guide?.dir).toEqual({ x: -1, y: 0 })
  })

  it('projection snap is skipped when the constrained ray runs parallel to the wall', () => {
    const host = makeWall({
      vertices: [
        { x: 0, y: 0 },
        { x: 240, y: 0 },
      ],
    })
    const snapping = makeSnapping([host], { grid: false })
    // Cursor within 2" of the host, but the ray can never land on it: the
    // point stays on the ray instead of dropping onto the wall.
    const result = snapping.resolve({ x: 60, y: 2 }, chain([200, 2], [100, 2], 2), false)
    expect(result.marker).toBeNull()
    expect(result.point).toEqual({ x: 60, y: 2 })
  })

  it('endpoint snap still wins over the constrained projection', () => {
    const host = makeWall({
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 240 },
      ],
    })
    const snapping = makeSnapping([host])
    const result = snapping.resolve({ x: 2, y: 3 }, chain([300, 300], [100, 100], 2), false)
    expect(result.marker).toBe('endpoint')
    expect(result.point).toEqual({ x: 0, y: 0 })
  })

  it('aligns the angle-snapped point with the chain start and returns the alignment guide', () => {
    const snapping = makeSnapping()
    // Drawing west along y=80 toward a chain started at the origin: the
    // vertical line through the start crosses the ray 2" ahead of the cursor.
    const result = snapping.resolve({ x: 2, y: 80.5 }, chain([0, 0], [100, 80], 3), false)
    expect(result.point.x).toBeCloseTo(0)
    expect(result.point.y).toBeCloseTo(80)
    expect(result.marker).toBeNull()
    expect(result.guide?.dir).toEqual({ x: -1, y: 0 })
    expect(result.alignGuide?.origin).toEqual({ x: 0, y: 0 })
    expect(result.alignGuide?.dir.x).toBeCloseTo(0)
    expect(result.alignGuide?.dir.y).toBeCloseTo(1)
  })

  it('skips start alignment when the crossing is beyond the threshold along the ray', () => {
    const snapping = makeSnapping()
    const result = snapping.resolve({ x: 20, y: 80.5 }, chain([0, 0], [100, 80], 3), false)
    // 20" short of the vertical line: the point stays angle+grid snapped.
    expect(result.point).toEqual({ x: 19, y: 80 })
    expect(result.alignGuide).toBeNull()
  })

  it('offers no start alignment for a single-vertex chain', () => {
    const snapping = makeSnapping()
    const result = snapping.resolve({ x: 100, y: 6 }, chain([0, 0], [0, 0], 1), false)
    expect(result.point.x).toBeCloseTo(99)
    expect(result.point.y).toBeCloseTo(0)
    expect(result.alignGuide).toBeNull()
  })

  it('snaps a free cursor onto the start alignment line when angle snap is off', () => {
    const snapping = makeSnapping([], { angle: false, grid: false })
    const result = snapping.resolve({ x: 1.5, y: 60 }, chain([0, 0], [100, 80], 3), false)
    expect(result.point).toEqual({ x: 0, y: 60 })
    expect(result.guide).toBeNull()
    expect(result.alignGuide?.origin).toEqual({ x: 0, y: 0 })
    expect(result.alignGuide?.dir).toEqual({ x: 0, y: 1 })
  })

  it('grid snapping does not perturb a start-aligned point', () => {
    const snapping = makeSnapping([], { angle: false })
    const result = snapping.resolve({ x: 1.5, y: 59 }, chain([0, 0], [100, 80], 3), false)
    expect(result.point).toEqual({ x: 0, y: 59 })
  })

  it('Alt disables the start alignment snap', () => {
    const snapping = makeSnapping()
    const result = snapping.resolve({ x: 1.5, y: 60 }, chain([0, 0], [100, 80], 3), true)
    expect(result.point).toEqual({ x: 1.5, y: 60 })
    expect(result.alignGuide).toBeNull()
  })

  it('close snap wins over start alignment near the start vertex', () => {
    const snapping = makeSnapping()
    const result = snapping.resolve({ x: 1, y: 1 }, chain([0, 0], [100, 80], 3), false)
    expect(result.marker).toBe('close')
    expect(result.alignGuide).toBeNull()
  })

  it('wall snaps win over start alignment', () => {
    const host = makeWall({
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 240 },
      ],
    })
    const snapping = makeSnapping([host])
    const result = snapping.resolve({ x: 2, y: 80 }, chain([0, 0], [100, 80], 3), false)
    expect(result.marker).toBe('projection')
    expect(result.alignGuide).toBeNull()
  })

  it('Alt (free) disables angle and grid but keeps wall snaps', () => {
    const host = makeWall({
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 240 },
      ],
    })
    const snapping = makeSnapping([host])
    const freePoint = snapping.resolve({ x: 100.4, y: 6.2 }, chain([0, 0], [0, 0], 1), true)
    expect(freePoint.point).toEqual({ x: 100.4, y: 6.2 })
    expect(freePoint.guide).toBeNull()

    const nearWall = snapping.resolve({ x: 2, y: 100 }, chain([300, 300], [300, 300], 1), true)
    expect(nearWall.marker).toBe('projection')
  })

  it('walls toggle off disables endpoint, midpoint and projection snaps', () => {
    const host = makeWall({
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 240 },
      ],
    })
    const snapping = makeSnapping([host], { walls: false, grid: false, angle: false })
    const result = snapping.resolve({ x: 2, y: 100 }, null, false)
    expect(result.marker).toBeNull()
    expect(result.point).toEqual({ x: 2, y: 100 })
  })

  it('threshold shrinks with zoom: 10px at 2 px/in captures within 5 inches only', () => {
    const host = makeWall({
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 240 },
      ],
    })
    const snapping = makeSnapping([host], { pixelsPerInch: 2 })
    expect(snapping.resolve({ x: 4.9, y: 100 }, null, false).marker).toBe('projection')
    expect(snapping.resolve({ x: 5.1, y: 100 }, null, false).marker).toBeNull()
  })
})

describe('useSnapping alignment guides (S1e)', () => {
  it('snaps a free point onto the vertical line through a wall endpoint and returns its guide', () => {
    const snapping = makeSnapping([makeWall()])
    const result = snapping.resolve({ x: 1.5, y: 60 }, null, false)
    expect(result.point).toEqual({ x: 0, y: 60 })
    expect(result.marker).toBeNull()
    expect(result.alignmentGuides).toHaveLength(1)
    expect(result.alignmentGuides[0].anchor).toEqual({ x: 0, y: 0 })
    expect(result.alignmentGuides[0].kind).toBe('endpoint')
    expect(result.alignmentGuides[0].dir).toEqual({ x: 0, y: 1 })
  })

  it('guide snap outranks the grid: the point stays on the guide, not grid-rounded', () => {
    const snapping = makeSnapping([makeWall()])
    const result = snapping.resolve({ x: 1.5, y: 59 }, null, false)
    expect(result.point).toEqual({ x: 0, y: 59 })
  })

  it('uses an interior corner vertex as an anchor, preferring the nearest collinear anchor', () => {
    const wall = makeWall({
      vertices: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: -120 },
      ],
    })
    const snapping = makeSnapping([wall])
    const result = snapping.resolve({ x: 121.5, y: 60 }, null, false)
    expect(result.point).toEqual({ x: 120, y: 60 })
    expect(result.alignmentGuides).toHaveLength(1)
    expect(result.alignmentGuides[0].anchor).toEqual({ x: 120, y: 0 })
    expect(result.alignmentGuides[0].kind).toBe('endpoint')
  })

  it('classifies an attached chain end as a junction anchor', () => {
    const host = makeWall({
      id: 'host',
      vertices: [
        { x: -50, y: 50 },
        { x: 50, y: 50 },
      ],
    })
    const attached = makeWall({
      id: 'attached',
      vertices: [
        { x: 80, y: -40 },
        { x: 0, y: 50 },
      ],
    })
    const snapping = makeSnapping([host, attached], {}, [ATTACHED_TEE])
    const result = snapping.resolve({ x: 2, y: -20 }, null, false)
    expect(result.point).toEqual({ x: 0, y: -20 })
    expect(result.alignmentGuides).toHaveLength(1)
    expect(result.alignmentGuides[0].anchor).toEqual({ x: 0, y: 50 })
    expect(result.alignmentGuides[0].kind).toBe('junction')
  })

  it('an endpoint anchor outranks a junction anchor even when its line is farther', () => {
    const host = makeWall({
      id: 'host',
      vertices: [
        { x: -50, y: 50 },
        { x: 50, y: 50 },
      ],
    })
    const attached = makeWall({
      id: 'attached',
      vertices: [
        { x: 80, y: -40 },
        { x: 0, y: 50 },
      ],
    })
    const far = makeWall({
      id: 'far',
      vertices: [
        { x: 6, y: -200 },
        { x: 6, y: -150 },
      ],
    })
    const snapping = makeSnapping([host, attached, far], {}, [ATTACHED_TEE])
    // The junction's line (x=0) is 2" away, the endpoint's line (x=6) is 4" away.
    const result = snapping.resolve({ x: 2, y: -20 }, null, false)
    expect(result.point).toEqual({ x: 6, y: -20 })
    expect(result.alignmentGuides).toHaveLength(1)
    expect(result.alignmentGuides[0].kind).toBe('endpoint')
    expect(result.alignmentGuides[0].anchor).toEqual({ x: 6, y: -150 })
  })

  it('snaps to the intersection of two guides from different anchors, rendering both', () => {
    const horizontal = makeWall({
      id: 'a',
      vertices: [
        { x: -100, y: 0 },
        { x: 0, y: 0 },
      ],
    })
    const vertical = makeWall({
      id: 'b',
      vertices: [
        { x: 200, y: 50 },
        { x: 300, y: 50 },
      ],
    })
    const snapping = makeSnapping([horizontal, vertical])
    const result = snapping.resolve({ x: 2, y: 48 }, null, false)
    expect(result.point.x).toBeCloseTo(0)
    expect(result.point.y).toBeCloseTo(50)
    expect(result.alignmentGuides).toHaveLength(2)
    const anchors = result.alignmentGuides.map((guide) => guide.anchor)
    expect(anchors).toContainEqual({ x: 0, y: 0 })
    expect(anchors).toContainEqual({ x: 200, y: 50 })
  })

  it('a direct wall snap outranks alignment guides', () => {
    const host = makeWall({
      id: 'host',
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 240 },
      ],
    })
    const guideSource = makeWall({
      id: 'source',
      vertices: [
        { x: 100, y: 50 },
        { x: 200, y: 50 },
      ],
    })
    const snapping = makeSnapping([host, guideSource])
    const result = snapping.resolve({ x: 2, y: 49 }, null, false)
    expect(result.marker).toBe('projection')
    expect(result.alignmentGuides).toHaveLength(0)
  })

  it('Alt suspends alignment guides', () => {
    const snapping = makeSnapping([makeWall()])
    const result = snapping.resolve({ x: 1.5, y: 59 }, null, true)
    expect(result.point).toEqual({ x: 1.5, y: 59 })
    expect(result.alignmentGuides).toHaveLength(0)
  })

  it('walls toggle off suspends alignment guides with the other wall-derived snaps', () => {
    const snapping = makeSnapping([makeWall()], { walls: false, grid: false, angle: false })
    const result = snapping.resolve({ x: 1.5, y: 59 }, null, false)
    expect(result.point).toEqual({ x: 1.5, y: 59 })
    expect(result.alignmentGuides).toHaveLength(0)
  })

  it('chain-start alignment (S1c) outranks the geometry guides while closing a loop', () => {
    const wall = makeWall({
      vertices: [
        { x: 0, y: 200 },
        { x: -100, y: 200 },
      ],
    })
    const snapping = makeSnapping([wall])
    // Drawing west along y=80 toward a chain started at the origin: both the
    // chain start and the wall endpoint (0,200) offer the vertical line x=0.
    const result = snapping.resolve({ x: 2, y: 80.5 }, chain([0, 0], [100, 80], 3), false)
    expect(result.point.x).toBeCloseTo(0)
    expect(result.point.y).toBeCloseTo(80)
    expect(result.alignGuide?.origin).toEqual({ x: 0, y: 0 })
    expect(result.alignmentGuides).toHaveLength(0)
  })

  it('slides an angle-constrained point along its ray to the guide crossing', () => {
    const wall = makeWall({
      vertices: [
        { x: 0, y: 200 },
        { x: -50, y: 200 },
      ],
    })
    const snapping = makeSnapping([wall])
    // Drawing west along y=80: the vertical guide through (0,200) crosses the
    // ray 2" ahead; the point slides there instead of grid-rounding.
    const result = snapping.resolve({ x: 2, y: 80.5 }, chain([100, 300], [100, 80], 2), false)
    expect(result.point).toEqual({ x: 0, y: 80 })
    expect(result.guide?.dir).toEqual({ x: -1, y: 0 })
    expect(result.alignGuide).toBeNull()
    expect(result.alignmentGuides).toHaveLength(1)
    expect(result.alignmentGuides[0].anchor).toEqual({ x: 0, y: 200 })
    expect(result.alignmentGuides[0].dir).toEqual({ x: 0, y: 1 })
  })

  it('anchors beyond the capture radius project no guides', () => {
    const wall = makeWall({
      vertices: [
        { x: 0, y: 300 },
        { x: 50, y: 300 },
      ],
    })
    const snapping = makeSnapping([wall])
    // Cursor 282" from the nearest vertex; capture is 250px / 1 px-per-inch.
    const result = snapping.resolve({ x: 1.5, y: 18 }, null, false)
    expect(result.alignmentGuides).toHaveLength(0)
  })
})

describe('useSnapping wall surfaces', () => {
  /** 12" shell running east on y = 0: surfaces at y = -6 and y = +6. */
  const SHELL = makeWall({
    id: 'shell',
    thickness_in: 12,
    vertices: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ],
  })

  it('captures a thick wall by its surface, which its spine is too far away to do', () => {
    // Pointing 1" outside the surface, 7" from the spine: beyond the 10" test
    // threshold here it would work either way, so squeeze the threshold to 3".
    const overrides = { pixelsPerInch: 10 / 3, grid: false, angle: false, surfaces: true }
    const onSurface = makeSnapping([SHELL], overrides).resolve({ x: 50, y: -7 }, null, false)

    expect(onSurface.point).toEqual({ x: 50, y: -6 })
    expect(onSurface.target).toEqual({
      kind: 'surface',
      wallId: 'shell',
      side: 'left',
      segmentIndex: 0,
    })

    // Without the network the only target is the invisible spine, 7" away.
    const spineOnly = makeSnapping([SHELL], { ...overrides, surfaces: false }).resolve(
      { x: 50, y: -7 },
      null,
      false,
    )
    expect(spineOnly.target).toBeNull()
    expect(spineOnly.point).not.toEqual({ x: 50, y: -6 })
  })

  it('reports the visible corner of a surface as a continuation target', () => {
    const result = makeSnapping([SHELL], { grid: false, angle: false, surfaces: true }).resolve(
      { x: 202, y: -5 },
      null,
      false,
    )

    expect(result.point).toEqual({ x: 200, y: -6 })
    expect(result.target).toEqual({
      kind: 'surface-end',
      wallId: 'shell',
      side: 'left',
      end: 'end',
      segmentIndex: 0,
    })
  })

  it('picks the nearest point target, so a spine end still wins when it is closer', () => {
    const result = makeSnapping([SHELL], { grid: false, angle: false, surfaces: true }).resolve(
      { x: 201, y: 1 },
      null,
      false,
    )

    expect(result.point).toEqual({ x: 200, y: 0 })
    expect(result.target).toEqual({ kind: 'wall-end', wallId: 'shell', end: 'end' })
  })

  it('keeps an angle-constrained segment on its ray when it lands on a surface', () => {
    const snapping = makeSnapping([SHELL], { grid: false, surfaces: true })
    // Drawing north from below, drifting 2" east: the segment must stay vertical
    // and still land on the shell's near surface.
    const result = snapping.resolve({ x: 52, y: 12 }, chain([50, 60], [50, 60], 1), false)

    expect(result.point.x).toBeCloseTo(50)
    expect(result.point.y).toBeCloseTo(6)
    expect(result.target?.kind).toBe('surface')
  })
})
