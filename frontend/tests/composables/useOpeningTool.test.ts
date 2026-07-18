import { describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'

import { useOpeningTool } from '@/composables/useOpeningTool'
import type { Opening, Wall } from '@/types/plan'
import { makeWall } from '../helpers/planFactory'

describe('useOpeningTool', () => {
  function setup(walls: Wall[], kind: 'door' | 'window' = 'door') {
    const commit = vi.fn<(opening: Opening) => void>()
    const tool = useOpeningTool({
      kind: computed(() => kind),
      walls: ref(walls),
      pixelsPerInch: ref(2),
      commit,
    })
    return { tool, commit }
  }

  it('previews the opening at the projected attachment while hovering a wall', () => {
    const { tool } = setup([makeWall()])

    tool.setCursor({ x: 60, y: 3 })
    expect(tool.preview.value).toMatchObject({
      kind: 'door',
      wall_id: 'wall-1',
      segment_index: 0,
      t: 60,
      width_in: 32,
      hinge: 'left',
      swing: 'in',
    })

    tool.setCursor({ x: 60, y: 50 })
    expect(tool.preview.value).toBeNull()
  })

  it('commits a door with the parametric host address on click', () => {
    const { tool, commit } = setup([makeWall()])

    tool.onClick({ x: 60, y: 3 })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0][0]).toMatchObject({
      kind: 'door',
      wall_id: 'wall-1',
      segment_index: 0,
      t: 60,
      width_in: 32,
    })
    expect(commit.mock.calls[0][0].id).not.toBe('opening-preview')
  })

  it('commits a window when the tool kind is window', () => {
    const { tool, commit } = setup([makeWall()], 'window')

    tool.onClick({ x: 60, y: 3 })
    expect(commit.mock.calls[0][0].kind).toBe('window')
  })

  it('clamps the placement so the opening stays within the segment', () => {
    const { tool, commit } = setup([makeWall()])

    tool.onClick({ x: 5, y: 1 })
    expect(commit.mock.calls[0][0].t).toBe(16)
  })

  it('does not commit when no wall is within reach', () => {
    const { tool, commit } = setup([makeWall()])

    tool.onClick({ x: 60, y: 50 })
    expect(commit).not.toHaveBeenCalled()
  })
})
