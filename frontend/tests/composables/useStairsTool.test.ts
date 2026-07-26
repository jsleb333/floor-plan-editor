import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import { useSnapping } from '@/composables/useSnapping'
import {
  DEFAULT_STAIRS_LENGTH_IN,
  DEFAULT_STAIRS_WIDTH_IN,
  useStairsTool,
} from '@/composables/useStairsTool'
import type { Stairs } from '@/types/plan'

describe('useStairsTool', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

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

  it('shows a horizontal hover ghost at the cursor before any press', () => {
    const { tool } = setup()

    tool.setCursor({ x: 50, y: 40 })
    expect(tool.preview.value).toMatchObject({
      origin: { x: 50, y: 40 },
      width_in: DEFAULT_STAIRS_WIDTH_IN,
      length_in: DEFAULT_STAIRS_LENGTH_IN,
      rotation_deg: 0,
      direction: 'up',
    })
    expect(tool.isDrawing.value).toBe(false)

    tool.setCursor(null)
    expect(tool.preview.value).toBeNull()
  })

  it('reflects the width and direction options in the hover ghost live', () => {
    const { tool } = setup()
    tool.setCursor({ x: 10, y: 20 })

    tool.setWidth(42)
    tool.setDirection('down')

    expect(tool.preview.value).toMatchObject({ width_in: 42, direction: 'down' })
  })

  it('ignores invalid widths from the options', () => {
    const { tool } = setup()

    tool.setWidth(0)
    tool.setWidth(Number.NaN)
    expect(tool.widthIn.value).toBe(DEFAULT_STAIRS_WIDTH_IN)
  })

  it('drives the drag preview and the commit with the options', () => {
    const { tool, commit } = setup()
    tool.setWidth(48)
    tool.setDirection('down')

    tool.onPress({ x: 0, y: 0 })
    tool.setCursor({ x: 96, y: 0 })
    expect(tool.preview.value).toMatchObject({ width_in: 48, direction: 'down' })

    tool.onRelease({ x: 96, y: 0 })
    expect(commit.mock.calls[0][0]).toMatchObject({
      width_in: 48,
      length_in: 96,
      direction: 'down',
    })
  })

  it('flips the direction with Tab while hovering and while dragging', () => {
    const { tool } = setup()

    tool.setCursor({ x: 10, y: 10 })
    expect(tool.handleKey('Tab')).toBe(true)
    expect(tool.direction.value).toBe('down')
    expect(tool.preview.value?.direction).toBe('down')

    tool.onPress({ x: 0, y: 0 })
    tool.setCursor({ x: 96, y: 0 })
    expect(tool.handleKey('Tab')).toBe(true)
    expect(tool.preview.value?.direction).toBe('up')
  })

  it('commits the exact typed length along the snapped drag direction on Enter', () => {
    const { tool, commit } = setup()

    tool.onPress({ x: 0, y: 0 })
    tool.setCursor({ x: 40, y: 2 })
    expect(tool.handleKey('8')).toBe(true)
    expect(tool.handleKey("'")).toBe(true)
    expect(tool.inputBuffer.value).toBe("8'")

    expect(tool.handleKey('Enter')).toBe(true)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0][0]).toMatchObject({
      origin: { x: 0, y: 0 },
      length_in: 96,
      rotation_deg: 0,
      direction: 'up',
    })
    expect(tool.inputBuffer.value).toBe('')
    expect(tool.isDrawing.value).toBe(false)
  })

  it('keeps the typed length exact when grid snapping is on', () => {
    const { tool, commit } = setup({ grid: true })

    tool.onPress({ x: 0, y: 0 })
    tool.setCursor({ x: 40, y: 0 })
    tool.handleKey('9')
    tool.handleKey('7')
    tool.handleKey('Enter')

    expect(commit.mock.calls[0][0].length_in).toBe(97)
  })

  it('ignores typed digits while not dragging', () => {
    const { tool } = setup()
    tool.setCursor({ x: 10, y: 10 })

    expect(tool.handleKey('9')).toBe(false)
    expect(tool.inputBuffer.value).toBe('')
  })

  it('edits the buffer with Backspace and clears it with Escape before cancelling the drag', () => {
    const { tool } = setup()
    tool.onPress({ x: 0, y: 0 })
    tool.setCursor({ x: 40, y: 0 })
    tool.handleKey('9')
    tool.handleKey('6')

    expect(tool.handleKey('Backspace')).toBe(true)
    expect(tool.inputBuffer.value).toBe('9')

    expect(tool.handleKey('Escape')).toBe(true)
    expect(tool.inputBuffer.value).toBe('')
    expect(tool.isDrawing.value).toBe(true)

    expect(tool.handleKey('Escape')).toBe(true)
    expect(tool.isDrawing.value).toBe(false)
  })

  it('restores the last-used options and committed length in a new instance', async () => {
    const { tool } = setup()
    tool.setWidth(42)
    tool.setDirection('down')
    tool.onPress({ x: 0, y: 0 })
    tool.onRelease({ x: 84, y: 0 })
    await nextTick()

    const restored = setup().tool
    restored.setCursor({ x: 0, y: 0 })
    expect(restored.preview.value).toMatchObject({
      width_in: 42,
      length_in: 84,
      direction: 'down',
    })
  })

  it('falls back to the defaults when the stored options are corrupted', () => {
    window.localStorage.setItem('floor-plan:stairs-tool-options', '{not json')

    const { tool } = setup()
    tool.setCursor({ x: 0, y: 0 })
    expect(tool.preview.value).toMatchObject({
      width_in: DEFAULT_STAIRS_WIDTH_IN,
      length_in: DEFAULT_STAIRS_LENGTH_IN,
      direction: 'up',
    })
  })

  it('falls back per field when the stored options have invalid values', () => {
    window.localStorage.setItem(
      'floor-plan:stairs-tool-options',
      JSON.stringify({ widthIn: -1, direction: 'down', lengthIn: 'long' }),
    )

    const { tool } = setup()
    expect(tool.widthIn.value).toBe(DEFAULT_STAIRS_WIDTH_IN)
    expect(tool.direction.value).toBe('down')
    tool.setCursor({ x: 0, y: 0 })
    expect(tool.preview.value?.length_in).toBe(DEFAULT_STAIRS_LENGTH_IN)
  })
})
