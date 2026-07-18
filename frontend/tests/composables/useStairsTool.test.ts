import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useSnapping } from '@/composables/useSnapping'
import { useStairsTool } from '@/composables/useStairsTool'
import type { Stairs } from '@/types/plan'

describe('useStairsTool', () => {
  function setup(settings?: { grid?: boolean; angle?: boolean }) {
    const snapping = useSnapping({
      walls: ref([]),
      pixelsPerInch: ref(2),
      settings: {
        grid: ref(settings?.grid ?? false),
        angle: ref(settings?.angle ?? true),
        walls: ref(false),
      },
    })
    const commit = vi.fn<(stairs: Stairs) => void>()
    const tool = useStairsTool({ snapping, commit })
    return { tool, commit }
  }

  it('commits a run from press origin along the angle-snapped drag direction', () => {
    const { tool, commit } = setup()

    tool.onPress({ x: 0, y: 0 })
    tool.setCursor({ x: 96, y: 3 })
    expect(tool.preview.value).toMatchObject({
      origin: { x: 0, y: 0 },
      width_in: 36,
      length_in: 96,
      rotation_deg: 0,
      direction: 'up',
    })

    tool.onRelease({ x: 96, y: 3 })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0][0]).toMatchObject({
      origin: { x: 0, y: 0 },
      width_in: 36,
      length_in: 96,
      rotation_deg: 0,
      direction: 'up',
    })
    expect(commit.mock.calls[0][0].id).not.toBe('stairs-preview')
    expect(tool.isDrawing.value).toBe(false)
  })

  it('snaps the run to 45 degrees and measures the length along the snapped direction', () => {
    const { tool, commit } = setup()

    tool.onPress({ x: 0, y: 0 })
    tool.onRelease({ x: 100, y: 90 })

    const run = commit.mock.calls[0][0]
    expect(run.rotation_deg).toBeCloseTo(45, 10)
    expect(run.length_in).toBeCloseTo(190 * Math.SQRT1_2, 10)
  })

  it('ignores drags shorter than the minimum run length', () => {
    const { tool, commit } = setup()

    tool.onPress({ x: 0, y: 0 })
    tool.onRelease({ x: 8, y: 0 })
    expect(commit).not.toHaveBeenCalled()
  })

  it('cancels the pending drag on Escape', () => {
    const { tool, commit } = setup()

    tool.onPress({ x: 0, y: 0 })
    expect(tool.handleKey('Escape')).toBe(true)
    expect(tool.isDrawing.value).toBe(false)

    tool.onRelease({ x: 96, y: 0 })
    expect(commit).not.toHaveBeenCalled()
  })
})
