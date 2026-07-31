import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { Ref } from 'vue'

import { useSnapping } from '@/composables/useSnapping'
import { useTapeTool } from '@/composables/useTapeTool'
import type { UseTapeToolReturn } from '@/composables/useTapeTool'
import type { Guide, Point, Wall } from '@/types/plan'
import {
  add,
  distance,
  dot,
  resolveGuideLine,
  resolveWallNetwork,
  scale,
  sub,
} from '@/utils/geometry'
import type { GuideLine } from '@/utils/geometry'
import { makeWall } from '../helpers/planFactory'

interface Harness {
  tool: UseTapeToolReturn
  committed: Guide[]
  walls: Ref<readonly Wall[]>
}

interface HarnessOverrides {
  walls?: Wall[]
  grid?: boolean
  angle?: boolean
}

/** A 12" shell wall running east, so both its surfaces sit 6" off the spine. */
const SHELL = makeWall({
  id: 'shell',
  thickness_in: 12,
  vertices: [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
  ],
})

/** Tape tool over an in-memory snap engine (pixelsPerInch 1 → threshold 10"). */
function makeTool(overrides: HarnessOverrides = {}): Harness {
  const walls: Ref<readonly Wall[]> = ref(overrides.walls ?? [])
  const network = ref(resolveWallNetwork(walls.value, []))
  const snapping = useSnapping({
    walls,
    network,
    pixelsPerInch: ref(1),
    settings: {
      grid: ref(overrides.grid ?? true),
      angle: ref(overrides.angle ?? true),
      walls: ref(true),
    },
  })
  const committed: Guide[] = []
  const tool = useTapeTool({ snapping, walls, commit: (guide) => committed.push(guide) })
  return { tool, committed, walls }
}

/** The committed guide resolved to its world line, as the document would resolve it. */
function lineOf(harness: Harness, guide: Guide): GuideLine {
  const line = resolveGuideLine(guide, harness.walls.value)
  if (!line) throw new Error('the committed guide does not resolve')
  return line
}

/** Perpendicular distance from an infinite guide line to a point. */
function offLine(line: GuideLine, point: Point): number {
  const along = dot(sub(point, line.point), line.dir)
  return distance(point, add(line.point, scale(line.dir, along)))
}

function type(tool: UseTapeToolReturn, text: string): void {
  for (const key of text) tool.handleKey(key)
}

/** The snapped cursor the preview is showing — what the next click would use. */
function seenPoint(tool: UseTapeToolReturn): Point {
  const point = tool.preview.value?.point
  if (!point) throw new Error('the preview has no snapped cursor')
  return point
}

describe('useTapeTool offset placement', () => {
  it('a surface click and a dragged second click place a guide through the point the user saw', () => {
    const harness = makeTool({ walls: [SHELL] })
    const { tool, committed } = harness
    // Aim just outside the shell's lower surface (y = 6), clear of every point target.
    tool.onClick({ x: 60, y: 8 })
    expect(tool.preview.value?.mode).toBe('offset')

    tool.setCursor({ x: 60, y: 36 })
    const seen = seenPoint(tool)
    tool.onClick({ x: 60, y: 36 })

    expect(committed).toHaveLength(1)
    const guide = committed[0]
    expect(guide).toMatchObject({
      kind: 'surface',
      wall_id: 'shell',
      segment_index: 0,
      side: 'right',
    })
    if (guide.kind !== 'surface') throw new Error('expected a surface guide')
    expect(guide.offset_in).toBeCloseTo(seen.y - 6)
    expect(guide.offset_in).toBeGreaterThan(0)
    expect(guide.id).toMatch(/[0-9a-f-]{36}/)
    // The round trip that matters: the stored relation resolves to the line the
    // user was dragging, not merely to something the same distance away.
    expect(offLine(lineOf(harness, guide), seen)).toBeCloseTo(0)
    expect(tool.isMeasuring.value).toBe(false)
  })

  it('a typed offset places the guide exactly that far from the surface', () => {
    const harness = makeTool({ walls: [SHELL] })
    const { tool, committed } = harness
    tool.onClick({ x: 60, y: 8 })
    tool.setCursor({ x: 60, y: 36 })
    type(tool, '36')
    expect(tool.inputBuffer.value).toBe('36')
    expect(tool.handleKey('Enter')).toBe(true)

    expect(committed).toHaveLength(1)
    const guide = committed[0]
    if (guide.kind !== 'surface') throw new Error('expected a surface guide')
    expect(guide.offset_in).toBe(36)
    // 36" outward from the lower surface at y = 6.
    const line = lineOf(harness, guide)
    expect(offLine(line, { x: 0, y: 42 })).toBeCloseTo(0)
    expect(tool.inputBuffer.value).toBe('')
  })

  it('accepts the feet-inches forms in the offset buffer (3\'0 is 36")', () => {
    const { tool, committed } = makeTool({ walls: [SHELL] })
    tool.onClick({ x: 60, y: 8 })
    tool.setCursor({ x: 60, y: 36 })
    type(tool, "3'0")
    expect(tool.inputBuffer.value).toBe("3'0")
    tool.handleKey('Enter')

    const guide = committed[0]
    if (guide.kind !== 'surface') throw new Error('expected a surface guide')
    expect(guide.offset_in).toBe(36)
  })

  it('dragging into the wall body gives a negative offset', () => {
    const harness = makeTool({ walls: [SHELL] })
    const { tool, committed } = harness
    tool.onClick({ x: 60, y: 8 })
    // Across the body to the far surface, 12" the other way from the one clicked.
    tool.setCursor({ x: 60, y: 0 })
    const seen = seenPoint(tool)
    tool.onClick({ x: 60, y: 0 })

    const guide = committed[0]
    if (guide.kind !== 'surface') throw new Error('expected a surface guide')
    expect(guide.offset_in).toBeCloseTo(-12)
    expect(offLine(lineOf(harness, guide), seen)).toBeCloseTo(0)
  })

  it('the offset chip reads the unsigned distance and follows the cursor', () => {
    const { tool } = makeTool({ walls: [SHELL] })
    tool.onClick({ x: 60, y: 8 })
    tool.setCursor({ x: 60, y: 0 })
    expect(tool.preview.value?.chip).toEqual({
      at: { x: 60, y: -6 },
      text: '1\'0"',
      secondary: null,
    })
    expect(tool.preview.value?.measurement).toBeNull()
  })

  it('Enter with an empty buffer commits at the current cursor', () => {
    const { tool, committed } = makeTool({ walls: [SHELL] })
    tool.onClick({ x: 60, y: 8 })
    tool.setCursor({ x: 60, y: 36 })
    const seen = seenPoint(tool)
    expect(tool.handleKey('Enter')).toBe(true)

    const guide = committed[0]
    if (guide.kind !== 'surface') throw new Error('expected a surface guide')
    expect(guide.offset_in).toBeCloseTo(seen.y - 6)
  })
})

describe('useTapeTool angle placement', () => {
  it('a wall end anchors the guide to that corner at the snapped angle', () => {
    const harness = makeTool({ walls: [SHELL] })
    const { tool, committed } = harness
    tool.onClick({ x: 199, y: 1 })
    expect(tool.preview.value?.mode).toBe('angle')

    tool.setCursor({ x: 320, y: 5 })
    expect(tool.preview.value?.chip?.text).toBe('0°')
    tool.onClick({ x: 320, y: 5 })

    expect(committed).toEqual([
      {
        id: expect.any(String),
        kind: 'point',
        anchor: { wall_id: 'shell', end: 'end' },
        angle_deg: 0,
      },
    ])
    // The anchored line runs through the corner it was measured from.
    expect(offLine(lineOf(harness, committed[0]), { x: 200, y: 0 })).toBeCloseTo(0)
  })

  it('a captured surface terminus anchors to its wall end, side and all', () => {
    const { tool, committed } = makeTool({ walls: [SHELL] })
    // The lower surface's corner at (200, 6) beats the spine end 7" away.
    tool.onClick({ x: 200, y: 7 })
    expect(tool.preview.value?.start).toEqual({ x: 200, y: 6 })
    tool.setCursor({ x: 200, y: 120 })
    tool.onClick({ x: 200, y: 120 })

    expect(committed).toEqual([
      {
        id: expect.any(String),
        kind: 'point',
        anchor: { wall_id: 'shell', end: 'end' },
        angle_deg: 90,
      },
    ])
  })

  it('Alt commits the raw dragged angle instead of the snapped one', () => {
    const { tool, committed } = makeTool({ walls: [SHELL] })
    tool.onClick({ x: 199, y: 1 })
    tool.setAlt(true)
    tool.setCursor({ x: 320, y: 5 })
    tool.onClick({ x: 320, y: 5 })

    const guide = committed[0]
    if (guide.kind !== 'point') throw new Error('expected a point guide')
    expect(guide.angle_deg).toBeCloseTo((Math.atan2(5, 120) * 180) / Math.PI)
    expect(guide.angle_deg).not.toBe(0)
  })

  it('a typed angle sets the guide angle exactly', () => {
    const { tool, committed } = makeTool({ walls: [SHELL] })
    tool.onClick({ x: 199, y: 1 })
    tool.setCursor({ x: 320, y: 5 })
    type(tool, '22.5')
    expect(tool.inputBuffer.value).toBe('22.5')
    expect(tool.handleKey('Enter')).toBe(true)

    const guide = committed[0]
    if (guide.kind !== 'point') throw new Error('expected a point guide')
    expect(guide.angle_deg).toBe(22.5)
  })

  it('the angle buffer takes digits and a decimal point only', () => {
    const { tool } = makeTool({ walls: [SHELL] })
    tool.onClick({ x: 199, y: 1 })
    expect(tool.handleKey("'")).toBe(false)
    expect(tool.handleKey('/')).toBe(false)
    type(tool, '4.5')
    expect(tool.inputBuffer.value).toBe('4.5')
    expect(tool.handleKey('Backspace')).toBe(true)
    expect(tool.inputBuffer.value).toBe('4.')
  })

  it('an unparseable typed angle keeps the buffer and places nothing', () => {
    const { tool, committed } = makeTool({ walls: [SHELL] })
    tool.onClick({ x: 199, y: 1 })
    type(tool, '1.2.3')
    expect(tool.handleKey('Enter')).toBe(true)
    expect(committed).toHaveLength(0)
    expect(tool.inputBuffer.value).toBe('1.2.3')
    expect(tool.isMeasuring.value).toBe(true)
  })
})

describe('useTapeTool free measuring', () => {
  it('carries the distance reading and commits a free guide on the second click', () => {
    const { tool, committed } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    expect(tool.preview.value?.mode).toBe('free')

    tool.setCursor({ x: 120, y: 0 })
    expect(tool.preview.value?.measurement).toBe('10\'0"')
    expect(tool.preview.value?.chip).toEqual({
      at: { x: 120, y: 0 },
      text: '10\'0"',
      secondary: '0°',
    })

    tool.onClick({ x: 120, y: 0 })
    expect(committed).toEqual([
      { id: expect.any(String), kind: 'free', origin: { x: 0, y: 0 }, angle_deg: 0 },
    ])
  })

  it('Escape after the first click places nothing — the measurement was the deliverable', () => {
    const { tool, committed } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.setCursor({ x: 120, y: 90 })
    expect(tool.preview.value?.measurement).toBe('12\'6"')

    expect(tool.handleKey('Escape')).toBe(true)
    expect(committed).toHaveLength(0)
    expect(tool.isMeasuring.value).toBe(false)
    expect(tool.preview.value?.mode).toBe('idle')
    expect(tool.handleKey('Enter')).toBe(false)
    expect(committed).toHaveLength(0)
  })

  it('Escape clears the buffer before abandoning the placement', () => {
    const { tool, committed } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.setCursor({ x: 120, y: 0 })
    type(tool, '45')
    expect(tool.handleKey('Escape')).toBe(true)
    expect(tool.inputBuffer.value).toBe('')
    expect(tool.isMeasuring.value).toBe(true)

    expect(tool.handleKey('Escape')).toBe(true)
    expect(tool.isMeasuring.value).toBe(false)
    expect(committed).toHaveLength(0)
  })
})

describe('useTapeTool idle state', () => {
  it('is inert before the first click', () => {
    const { tool, committed } = makeTool({ walls: [SHELL] })
    expect(tool.preview.value).toBeNull()
    expect(tool.handleKey('Escape')).toBe(false)
    expect(tool.handleKey('Enter')).toBe(false)
    expect(tool.handleKey('1')).toBe(false)
    expect(tool.handleKey('Backspace')).toBe(false)
    expect(tool.inputBuffer.value).toBe('')
    expect(committed).toHaveLength(0)

    tool.setCursor({ x: 60, y: 8 })
    expect(tool.preview.value).toMatchObject({
      mode: 'idle',
      start: null,
      point: { x: 60, y: 6 },
      line: null,
      chip: null,
      measurement: null,
      marker: { kind: 'projection', point: { x: 60, y: 6 } },
    })
  })

  it('deactivate abandons the pending placement, the buffer and the cursor', () => {
    const { tool, committed } = makeTool({ walls: [SHELL] })
    tool.onClick({ x: 60, y: 8 })
    tool.setCursor({ x: 60, y: 36 })
    type(tool, '36')
    tool.deactivate()

    expect(tool.preview.value).toBeNull()
    expect(tool.inputBuffer.value).toBe('')
    expect(tool.isMeasuring.value).toBe(false)
    expect(committed).toHaveLength(0)
  })
})

describe('useTapeTool on a closed loop', () => {
  it('places a parallel guide off the closing side, like every other side (the reported defect)', () => {
    // A closed rectangular loop drawn as one chain: the closing segment (vertex
    // 3 back to vertex 0) used to offer no surface target, so the tape fell
    // through to a free point+angle guide instead of a parallel one.
    const loop = makeWall({
      id: 'loop',
      closed: true,
      vertices: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: 120 },
        { x: 0, y: 120 },
      ],
    })
    const { tool, committed } = makeTool({ walls: [loop] })

    // First click just outside the closing side's face (x = -1.75), off-centre.
    // The drop is made with Alt held: at this harness scale the S1e alignment
    // lines through the loop's eight face corners blanket the area and would
    // (correctly) capture the click and shift the offset with the chip in
    // agreement — Alt is the documented way to place free of the magnets.
    tool.onClick({ x: -2.75, y: 30 })
    tool.setAlt(true)
    tool.setCursor({ x: -30, y: 45 })
    tool.onClick({ x: -30, y: 45 })

    expect(committed).toHaveLength(1)
    const guide = committed[0]
    expect(guide.kind).toBe('surface')
    if (guide.kind === 'surface') {
      expect(guide.wall_id).toBe('loop')
      expect(guide.segment_index).toBe(3)
      expect(guide.offset_in).toBeCloseTo(28.25)
      // The committed relation resolves to a vertical line through the point
      // the user dropped it on.
      const line = resolveGuideLine(guide, [loop])
      expect(line).not.toBeNull()
      expect(Math.abs(line?.dir.x ?? 1)).toBeCloseTo(0)
      expect(line?.point.x).toBeCloseTo(-30)
    }
  })
})
