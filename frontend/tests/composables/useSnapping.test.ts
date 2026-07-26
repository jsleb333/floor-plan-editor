import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { Ref } from 'vue'

import { useSnapping } from '@/composables/useSnapping'
import type { SnapChainContext, UseSnappingReturn } from '@/composables/useSnapping'
import type { Wall } from '@/types/plan'
import { makeWall } from '../helpers/planFactory'

interface SnappingOverrides {
  grid?: boolean
  angle?: boolean
  walls?: boolean
  pixelsPerInch?: number
}

/** Snap engine over the given walls; pixelsPerInch defaults to 1 (threshold = 10"). */
function makeSnapping(walls: Wall[] = [], overrides: SnappingOverrides = {}): UseSnappingReturn {
  const wallsRef: Ref<readonly Wall[]> = ref(walls)
  return useSnapping({
    walls: wallsRef,
    pixelsPerInch: ref(overrides.pixelsPerInch ?? 1),
    settings: {
      grid: ref(overrides.grid ?? true),
      angle: ref(overrides.angle ?? true),
      walls: ref(overrides.walls ?? true),
    },
  })
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
