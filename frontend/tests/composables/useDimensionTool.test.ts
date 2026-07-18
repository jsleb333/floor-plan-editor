import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useDimensionTool } from '@/composables/useDimensionTool'
import { useSnapping } from '@/composables/useSnapping'
import type { Dimension, Wall } from '@/types/plan'
import { makeWall } from '../helpers/planFactory'

describe('useDimensionTool', () => {
  function setup(walls: Wall[] = [], settings?: { grid?: boolean; walls?: boolean }) {
    const snapping = useSnapping({
      walls: ref(walls),
      pixelsPerInch: ref(2),
      settings: {
        grid: ref(settings?.grid ?? false),
        angle: ref(false),
        walls: ref(settings?.walls ?? false),
      },
    })
    const commit = vi.fn<(dimension: Dimension) => void>()
    const tool = useDimensionTool({ snapping, commit })
    return { tool, commit }
  }

  it('commits a dimension between two clicked points with the default offset', () => {
    const { tool, commit } = setup()

    tool.onClick({ x: 0, y: 0 })
    expect(tool.isDrawing.value).toBe(true)
    expect(commit).not.toHaveBeenCalled()

    tool.onClick({ x: 120, y: 0 })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0][0]).toMatchObject({
      p1: { x: 0, y: 0 },
      p2: { x: 120, y: 0 },
      offset_in: 12,
    })
    expect(tool.isDrawing.value).toBe(false)
  })

  it('snaps each click to wall endpoints when wall snapping is on', () => {
    const { tool, commit } = setup([makeWall()], { walls: true })

    tool.onClick({ x: 2, y: 2 })
    tool.onClick({ x: 118, y: -2 })

    expect(commit.mock.calls[0][0]).toMatchObject({
      p1: { x: 0, y: 0 },
      p2: { x: 120, y: 0 },
    })
  })

  it('snaps clicks to the grid when grid snapping is on', () => {
    const { tool, commit } = setup([], { grid: true })

    tool.onClick({ x: 1, y: 1 })
    tool.onClick({ x: 119, y: 2 })

    expect(commit.mock.calls[0][0]).toMatchObject({
      p1: { x: 0, y: 0 },
      p2: { x: 120, y: 3 },
    })
  })

  it('previews the pending line between the first point and the snapped cursor', () => {
    const { tool } = setup()

    tool.onClick({ x: 0, y: 0 })
    tool.setCursor({ x: 60, y: 30 })

    expect(tool.preview.value?.start).toEqual({ x: 0, y: 0 })
    expect(tool.preview.value?.dimension).toMatchObject({
      p1: { x: 0, y: 0 },
      p2: { x: 60, y: 30 },
      offset_in: 12,
    })
  })

  it('cancels the pending first point on Escape and ignores zero-length dimensions', () => {
    const { tool, commit } = setup()

    tool.onClick({ x: 0, y: 0 })
    expect(tool.handleKey('Escape')).toBe(true)
    expect(tool.isDrawing.value).toBe(false)
    expect(tool.handleKey('Escape')).toBe(false)

    tool.onClick({ x: 5, y: 5 })
    tool.onClick({ x: 5, y: 5 })
    expect(commit).not.toHaveBeenCalled()
    expect(tool.isDrawing.value).toBe(true)
  })
})
