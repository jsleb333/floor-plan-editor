import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useCalibrateTool } from '@/composables/useCalibrateTool'
import type { Underlay } from '@/types/plan'
import { underlayToWorld, worldToUnderlayPixel } from '@/utils/underlay'

function setup(underlayValue: Underlay | null) {
  const underlay = ref(underlayValue)
  const commit = vi.fn<(next: Underlay) => void>()
  const onApplied = vi.fn()
  const tool = useCalibrateTool({ underlay, commit, onApplied })
  return { underlay, commit, onApplied, tool }
}

function makeUnderlay(): Underlay {
  return {
    image_ref: 'a1',
    transform: { origin: { x: 100, y: 50 }, rotation_deg: 30, scale: 0.5 },
    opacity: 0.4,
    locked: false,
    visible: true,
  }
}

function type(tool: ReturnType<typeof setup>['tool'], text: string): void {
  for (const char of text) tool.handleKey(char)
}

describe('useCalibrateTool', () => {
  it('rescales about the first clicked point so the world point under it stays fixed', () => {
    const initial = makeUnderlay()
    const { commit, onApplied, tool } = setup(initial)
    const anchor = { x: 130, y: 80 }
    const pixelUnderAnchor = worldToUnderlayPixel(initial.transform, anchor)

    tool.onClick(anchor)
    tool.onClick({ x: 190, y: 80 }) // 60" segment under the current transform
    type(tool, "10'") // that 60" span should really be 120"
    tool.handleKey('Enter')

    expect(commit).toHaveBeenCalledOnce()
    const committed = commit.mock.calls[0][0]
    // 60 world inches at scale 0.5 covers 120 px; 120px == 120" -> newScale 1.0.
    expect(committed.transform.scale).toBeCloseTo(1, 6)
    const anchorAfter = underlayToWorld(committed.transform, pixelUnderAnchor)
    expect(anchorAfter.x).toBeCloseTo(anchor.x, 6)
    expect(anchorAfter.y).toBeCloseTo(anchor.y, 6)
    expect(onApplied).toHaveBeenCalledOnce()
  })

  it('previews the live length and awaits the typed value after the second click', () => {
    const { tool } = setup(makeUnderlay())
    tool.onClick({ x: 0, y: 0 })
    tool.setCursor({ x: 120, y: 0 })
    expect(tool.preview.value.lengthLabel).toBe('10\'0"')
    expect(tool.preview.value.awaitingLength).toBe(false)

    tool.onClick({ x: 120, y: 0 })
    expect(tool.isAwaitingLength.value).toBe(true)
  })

  it('Escape cancels the pending segment without committing', () => {
    const { commit, onApplied, tool } = setup(makeUnderlay())
    tool.onClick({ x: 0, y: 0 })
    expect(tool.handleKey('Escape')).toBe(true)
    expect(tool.preview.value.a).toBeNull()
    expect(commit).not.toHaveBeenCalled()
    expect(onApplied).not.toHaveBeenCalled()
  })

  it('warns and never commits when there is no underlay to calibrate', () => {
    const { commit, tool } = setup(null)
    expect(tool.preview.value.warning).not.toBeNull()
    tool.onClick({ x: 0, y: 0 })
    expect(tool.preview.value.a).toBeNull()
    expect(commit).not.toHaveBeenCalled()
  })
})
