import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { Ref } from 'vue'

import { useSnapping } from '@/composables/useSnapping'
import { useWallTool } from '@/composables/useWallTool'
import type { UseWallToolReturn } from '@/composables/useWallTool'
import type { Wall } from '@/types/plan'
import { makeWall } from '../helpers/planFactory'

interface Harness {
  tool: UseWallToolReturn
  committed: Wall[]
}

interface HarnessOverrides {
  walls?: Wall[]
  grid?: boolean
  angle?: boolean
  wallSnaps?: boolean
}

/** Wall tool over an in-memory snap engine (pixelsPerInch 1 → threshold 10"). */
function makeTool(overrides: HarnessOverrides = {}): Harness {
  const walls: Ref<readonly Wall[]> = ref(overrides.walls ?? [])
  const snapping = useSnapping({
    walls,
    pixelsPerInch: ref(1),
    settings: {
      grid: ref(overrides.grid ?? true),
      angle: ref(overrides.angle ?? true),
      walls: ref(overrides.wallSnaps ?? true),
    },
  })
  const committed: Wall[] = []
  const tool = useWallTool({ snapping, commit: (wall) => committed.push(wall) })
  return { tool, committed }
}

function type(tool: UseWallToolReturn, text: string): void {
  for (const key of text) tool.handleKey(key)
}

describe('useWallTool drawing', () => {
  it('click, click, Enter commits an open two-vertex wall with the active options', () => {
    const { tool, committed } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.onClick({ x: 100, y: 5 })
    expect(tool.handleKey('Enter')).toBe(true)

    expect(committed).toHaveLength(1)
    const wall = committed[0]
    expect(wall.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 99, y: 0 },
    ])
    expect(wall.closed).toBe(false)
    expect(wall.thickness_in).toBe(3.5)
    expect(wall.reference).toBe('center')
    expect(wall.locked_segments).toEqual([])
    expect(wall.id).toMatch(/[0-9a-f-]{36}/)
    expect(tool.isDrawing.value).toBe(false)
  })

  it('Enter with a single vertex cancels instead of committing', () => {
    const { tool, committed } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.handleKey('Enter')
    expect(committed).toHaveLength(0)
    expect(tool.isDrawing.value).toBe(false)
  })

  it('Escape cancels the in-progress chain without committing', () => {
    const { tool, committed } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.onClick({ x: 120, y: 0 })
    expect(tool.handleKey('Escape')).toBe(true)
    expect(committed).toHaveLength(0)
    expect(tool.isDrawing.value).toBe(false)
  })

  it('double-click finishes the chain, dropping the stray duplicate vertex', () => {
    const { tool, committed } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.onClick({ x: 120, y: 2 })
    tool.onClick({ x: 120, y: 2 })
    tool.onDoubleClick()
    expect(committed).toHaveLength(1)
    expect(committed[0].vertices).toEqual([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
    ])
  })

  it('typed exact length places the next vertex at that distance along the snapped direction', () => {
    const { tool, committed } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.setCursor({ x: 50, y: 2 })
    type(tool, "10'")
    expect(tool.inputBuffer.value).toBe("10'")
    tool.handleKey('Enter')
    expect(tool.inputBuffer.value).toBe('')
    tool.handleKey('Enter')

    expect(committed).toHaveLength(1)
    expect(committed[0].vertices[1].x).toBeCloseTo(120)
    expect(committed[0].vertices[1].y).toBeCloseTo(0)
  })

  it('Backspace edits the buffer; Escape clears it before cancelling the chain', () => {
    const { tool, committed } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.setCursor({ x: 50, y: 0 })
    type(tool, '125')
    tool.handleKey('Backspace')
    expect(tool.inputBuffer.value).toBe('12')

    tool.handleKey('Escape')
    expect(tool.inputBuffer.value).toBe('')
    expect(tool.isDrawing.value).toBe(true)

    tool.handleKey('Escape')
    expect(tool.isDrawing.value).toBe(false)
    expect(committed).toHaveLength(0)
  })

  it('an invalid typed length keeps the buffer and places nothing', () => {
    const { tool, committed } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.setCursor({ x: 50, y: 0 })
    type(tool, '1/0')
    tool.handleKey('Enter')
    expect(tool.inputBuffer.value).toBe('1/0')
    tool.handleKey('Escape')
    tool.handleKey('Enter')
    expect(committed).toHaveLength(0)
  })

  it('digits are not buffered before the first vertex is placed', () => {
    const { tool } = makeTool()
    expect(tool.handleKey('1')).toBe(false)
    expect(tool.inputBuffer.value).toBe('')
  })

  it('Tab cycles the reference side and the committed wall carries it', () => {
    const { tool, committed } = makeTool()
    expect(tool.handleKey('Tab')).toBe(true)
    expect(tool.reference.value).toBe('left')
    tool.onClick({ x: 0, y: 0 })
    tool.onClick({ x: 120, y: 0 })
    tool.handleKey('Enter')
    expect(committed[0].reference).toBe('left')

    tool.handleKey('Tab')
    expect(tool.reference.value).toBe('right')
    tool.handleKey('Tab')
    expect(tool.reference.value).toBe('center')
  })

  it('clicking the chain start closes the loop with an auto-square corner', () => {
    const { tool, committed } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.onClick({ x: 240, y: 0 })
    tool.onClick({ x: 240, y: 120 })
    tool.onClick({ x: 1, y: 1 })

    // Heading from (240,120) to the start snaps to the 225° diagonal; the
    // auto-square corner is its intersection with the x-axis arrival line.
    expect(committed).toHaveLength(1)
    const wall = committed[0]
    expect(wall.closed).toBe(true)
    expect(wall.vertices).toHaveLength(4)
    expect(wall.vertices[3].x).toBeCloseTo(120)
    expect(wall.vertices[3].y).toBeCloseTo(0)
    expect(tool.isDrawing.value).toBe(false)
  })

  it('placing the penultimate vertex snaps it in line with the chain start', () => {
    const { tool, committed } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.onClick({ x: 240, y: 0 })
    tool.onClick({ x: 240, y: 120 })
    // 3" short of lining up with the start: alignment pulls it to x=0, so the
    // close needs no correction at all.
    tool.onClick({ x: 3, y: 121 })
    tool.onClick({ x: 1, y: 1 })

    expect(committed).toHaveLength(1)
    const wall = committed[0]
    expect(wall.closed).toBe(true)
    expect(wall.vertices).toHaveLength(4)
    expect(wall.vertices[3].x).toBeCloseTo(0)
    expect(wall.vertices[3].y).toBeCloseTo(120)
  })

  it('closing nudges a slightly misaligned chain end onto the start alignment line', () => {
    const { tool, committed } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.onClick({ x: 240, y: 0 })
    tool.onClick({ x: 240, y: 120 })
    tool.setAlt(true)
    tool.onClick({ x: 2, y: 120 })
    tool.setAlt(false)
    tool.onClick({ x: 1, y: 1 })

    // The 2" misalignment slides away along the final segment instead of
    // spawning an auto-square micro-stub.
    expect(committed).toHaveLength(1)
    const wall = committed[0]
    expect(wall.closed).toBe(true)
    expect(wall.vertices).toHaveLength(4)
    expect(wall.vertices[3].x).toBeCloseTo(0)
    expect(wall.vertices[3].y).toBeCloseTo(120)
  })

  it('the aligned close nudge applies even with angle snapping off', () => {
    const { tool, committed } = makeTool({ angle: false, grid: false })
    tool.onClick({ x: 0, y: 0 })
    tool.onClick({ x: 240, y: 0 })
    tool.onClick({ x: 240, y: 120 })
    tool.setAlt(true)
    tool.onClick({ x: 2, y: 120 })
    tool.setAlt(false)
    tool.onClick({ x: 1, y: 1 })

    expect(committed).toHaveLength(1)
    expect(committed[0].vertices).toHaveLength(4)
    expect(committed[0].vertices[3].x).toBeCloseTo(0)
    expect(committed[0].vertices[3].y).toBeCloseTo(120)
  })

  it('Alt-clicking the chain start closes with a direct segment instead', () => {
    const { tool, committed } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.onClick({ x: 240, y: 0 })
    tool.onClick({ x: 240, y: 200 })
    tool.setAlt(true)
    tool.onClick({ x: 1, y: 1 })

    expect(committed).toHaveLength(1)
    expect(committed[0].closed).toBe(true)
    expect(committed[0].vertices).toHaveLength(3)
  })

  it('starting on a projection snap records a start T-junction on the new wall', () => {
    const host = makeWall({
      id: 'host',
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 240 },
      ],
    })
    const { tool, committed } = makeTool({ walls: [host] })
    tool.onClick({ x: 2, y: 100 })
    tool.onClick({ x: 150, y: 100 })
    tool.handleKey('Enter')

    expect(committed[0].vertices[0]).toEqual({ x: 0, y: 100 })
    expect(committed[0].junctions).toEqual([
      { end: 'start', host_wall_id: 'host', segment_index: 0, t: 100 },
    ])
  })

  it('ending on a projection snap records an end T-junction on the new wall', () => {
    const host = makeWall({
      id: 'host',
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 240 },
      ],
    })
    const { tool, committed } = makeTool({ walls: [host] })
    tool.onClick({ x: 60, y: 60 })
    tool.onClick({ x: 2, y: 60 })
    tool.handleKey('Enter')

    expect(committed[0].vertices[1]).toEqual({ x: 0, y: 60 })
    expect(committed[0].junctions).toEqual([
      { end: 'end', host_wall_id: 'host', segment_index: 0, t: 60 },
    ])
  })

  it('ending on a wall keeps the snapped angle, landing the junction on the ray crossing', () => {
    const host = makeWall({
      id: 'host',
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 240 },
      ],
    })
    const { tool, committed } = makeTool({ walls: [host] })
    tool.onClick({ x: 60, y: 60 })
    // Cursor drifts 3" off the horizontal while reaching for the host wall:
    // the segment must stay horizontal instead of following the cursor.
    tool.onClick({ x: 2, y: 63 })
    tool.handleKey('Enter')

    expect(committed[0].vertices[1].x).toBeCloseTo(0)
    expect(committed[0].vertices[1].y).toBeCloseTo(60)
    expect(committed[0].junctions).toEqual([
      { end: 'end', host_wall_id: 'host', segment_index: 0, t: 60 },
    ])
  })

  it('setThickness rejects non-positive values', () => {
    const { tool } = makeTool()
    tool.setThickness(-2)
    tool.setThickness(0)
    expect(tool.thicknessIn.value).toBe(3.5)
    tool.setThickness(12)
    expect(tool.thicknessIn.value).toBe(12)
  })
})

describe('useWallTool preview', () => {
  it('shows the pending silhouette, live length label and angle guide', () => {
    const { tool } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.setCursor({ x: 100, y: 5 })

    const preview = tool.preview.value
    expect(preview).not.toBeNull()
    expect(preview?.point).toEqual({ x: 99, y: 0 })
    expect(preview?.segment).toEqual({ a: { x: 0, y: 0 }, b: { x: 99, y: 0 } })
    expect(preview?.lengthLabel).toBe(`8'3"`)
    expect(preview?.guide?.dir).toEqual({ x: 1, y: 0 })
    expect(preview?.rings.length).toBeGreaterThan(0)
  })

  it('reference "left" grows the preview body to the right of travel (y-down)', () => {
    const { tool } = makeTool()
    tool.setReference('left')
    tool.onClick({ x: 0, y: 0 })
    tool.setCursor({ x: 120, y: 0 })

    const ys = tool.preview.value?.rings.flat().map((p) => p.y) ?? []
    expect(Math.min(...ys)).toBeCloseTo(0)
    expect(Math.max(...ys)).toBeCloseTo(3.5)
  })

  it('shows the endpoint marker before any vertex is placed', () => {
    const host = makeWall({
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 240 },
      ],
    })
    const { tool } = makeTool({ walls: [host] })
    tool.setCursor({ x: 3, y: 2 })

    const preview = tool.preview.value
    expect(preview?.marker?.kind).toBe('endpoint')
    expect(preview?.marker?.point).toEqual({ x: 0, y: 0 })
  })

  it('engages the close affordance and previews the auto-squared loop', () => {
    const { tool } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.onClick({ x: 240, y: 0 })
    tool.onClick({ x: 240, y: 200 })
    tool.setCursor({ x: 1, y: 1 })

    const preview = tool.preview.value
    expect(preview?.closePoint).toEqual({ x: 0, y: 0 })
    // Closed-loop preview renders two rings (outer + inner face).
    expect(preview?.rings).toHaveLength(2)
  })

  it('previews the nudged close silhouette before the click', () => {
    const { tool } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.onClick({ x: 240, y: 0 })
    tool.onClick({ x: 240, y: 120 })
    tool.setAlt(true)
    tool.onClick({ x: 2, y: 120 })
    tool.setAlt(false)
    tool.setCursor({ x: 1, y: 1 })

    const preview = tool.preview.value
    expect(preview?.closePoint).toEqual({ x: 0, y: 0 })
    expect(preview?.rings).toHaveLength(2)
    // The outer mitre corner at the nudged vertex proves the closing face is
    // exactly vertical — the uncorrected chain end (x=2) cannot produce it.
    const corner = preview?.rings
      .flat()
      .find((p) => Math.abs(p.x + 1.75) < 0.01 && Math.abs(p.y - 121.75) < 0.01)
    expect(corner).toBeDefined()
  })

  it('exposes the alignment guide while drawing toward the start line', () => {
    const { tool } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.onClick({ x: 240, y: 0 })
    tool.onClick({ x: 240, y: 120 })
    tool.setCursor({ x: 3, y: 121 })

    const preview = tool.preview.value
    expect(preview?.point?.x).toBeCloseTo(0)
    expect(preview?.point?.y).toBeCloseTo(120)
    expect(preview?.alignGuide?.origin).toEqual({ x: 0, y: 0 })
    expect(preview?.alignGuide?.dir.x).toBeCloseTo(0)
    expect(preview?.alignGuide?.dir.y).toBeCloseTo(1)
  })

  it('deactivate clears the chain and cursor without committing', () => {
    const { tool, committed } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.onClick({ x: 120, y: 0 })
    tool.deactivate()
    expect(committed).toHaveLength(0)
    expect(tool.isDrawing.value).toBe(false)
    expect(tool.preview.value).toBeNull()
  })
})

describe('useWallTool ids', () => {
  it('each committed wall gets a distinct uuid', () => {
    const { tool, committed } = makeTool()
    tool.onClick({ x: 0, y: 0 })
    tool.onClick({ x: 120, y: 0 })
    tool.handleKey('Enter')
    tool.onClick({ x: 0, y: 60 })
    tool.onClick({ x: 120, y: 60 })
    tool.handleKey('Enter')
    expect(committed).toHaveLength(2)
    expect(committed[0].id).not.toBe(committed[1].id)
  })
})
