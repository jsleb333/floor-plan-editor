import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref } from 'vue'

import {
  DEFAULT_DOOR_WIDTH_IN,
  DEFAULT_WINDOW_WIDTH_IN,
  useOpeningTool,
} from '@/composables/useOpeningTool'
import type { Opening, Wall } from '@/types/plan'
import { makeWall } from '../helpers/planFactory'

/** Cursor points around the default east-running wall (y grows down on screen). */
const ABOVE_WALL = { x: 60, y: -3 }
const BELOW_WALL = { x: 60, y: 3 }
const OFF_WALL = { x: 60, y: 50 }

describe('useOpeningTool', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  function setup(walls: Wall[] = [makeWall()], kind: 'door' | 'window' = 'door') {
    const commit = vi.fn<(opening: Opening) => void>()
    const tool = useOpeningTool({
      kind: computed(() => kind),
      walls: ref(walls),
      pixelsPerInch: ref(2),
      commit,
    })
    return { tool, commit }
  }

  it('previews the opening at the projected attachment with the default options', () => {
    const { tool } = setup()

    tool.setCursor(ABOVE_WALL)
    expect(tool.preview.value).toMatchObject({
      kind: 'door',
      wall_id: 'wall-1',
      segment_index: 0,
      t: 60,
      width_in: DEFAULT_DOOR_WIDTH_IN,
      style: 'swing',
      hinge: 'left',
      swing: 'in',
    })

    tool.setCursor(OFF_WALL)
    expect(tool.preview.value).toBeNull()
  })

  it('swings the door toward the side of the wall the cursor is on', () => {
    const { tool } = setup()

    tool.setCursor(BELOW_WALL)
    expect(tool.preview.value?.swing).toBe('out')
    expect(tool.swing.value).toBe('out')

    tool.setCursor(ABOVE_WALL)
    expect(tool.preview.value?.swing).toBe('in')
    expect(tool.swing.value).toBe('in')
  })

  it('lets the options toggle set the swing, with the cursor overriding it again', () => {
    const { tool } = setup()

    tool.setSwing('out')
    expect(tool.swing.value).toBe('out')

    tool.setCursor(ABOVE_WALL)
    expect(tool.swing.value).toBe('in')
    expect(tool.preview.value?.swing).toBe('in')
  })

  it('cycles the hinge side with Tab and reflects it in the preview', () => {
    const { tool } = setup()
    tool.setCursor(ABOVE_WALL)

    expect(tool.handleKey('Tab')).toBe(true)
    expect(tool.hinge.value).toBe('right')
    expect(tool.preview.value?.hinge).toBe('right')

    expect(tool.handleKey('Tab')).toBe(true)
    expect(tool.hinge.value).toBe('left')
  })

  it('ignores Tab for the window tool', () => {
    const { tool } = setup([makeWall()], 'window')

    expect(tool.handleKey('Tab')).toBe(false)
  })

  it('drives the preview and the commit with the width option', () => {
    const { tool, commit } = setup()
    tool.setWidth(30)
    tool.setHinge('right')

    tool.setCursor(BELOW_WALL)
    expect(tool.preview.value).toMatchObject({ width_in: 30, hinge: 'right', swing: 'out' })

    tool.onClick(BELOW_WALL)
    expect(commit.mock.calls[0][0]).toMatchObject({
      kind: 'door',
      width_in: 30,
      hinge: 'right',
      swing: 'out',
    })
    expect(commit.mock.calls[0][0].id).not.toBe('opening-preview')
  })

  it('sets the width exactly from digits typed while hovering', () => {
    const { tool } = setup()
    tool.setCursor(ABOVE_WALL)

    expect(tool.handleKey('3')).toBe(true)
    expect(tool.handleKey('0')).toBe(true)
    expect(tool.inputBuffer.value).toBe('30')

    expect(tool.handleKey('Enter')).toBe(true)
    expect(tool.inputBuffer.value).toBe('')
    expect(tool.widthIn.value).toBe(30)
    expect(tool.preview.value?.width_in).toBe(30)
  })

  it('ignores typed digits while not hovering a wall', () => {
    const { tool } = setup()

    expect(tool.handleKey('3')).toBe(false)
    expect(tool.inputBuffer.value).toBe('')
  })

  it('clears the typed buffer with Escape without touching the width', () => {
    const { tool } = setup()
    tool.setCursor(ABOVE_WALL)
    tool.handleKey('3')

    expect(tool.handleKey('Escape')).toBe(true)
    expect(tool.inputBuffer.value).toBe('')
    expect(tool.widthIn.value).toBe(DEFAULT_DOOR_WIDTH_IN)
    expect(tool.handleKey('Escape')).toBe(false)
  })

  it('commits a window with its own default width and kind', () => {
    const { tool, commit } = setup([makeWall()], 'window')

    tool.onClick(ABOVE_WALL)
    expect(commit.mock.calls[0][0]).toMatchObject({
      kind: 'window',
      width_in: DEFAULT_WINDOW_WIDTH_IN,
    })
  })

  it('keeps door and window widths independent', async () => {
    const door = setup()
    door.tool.setWidth(30)
    await nextTick()
    const window_ = setup([makeWall()], 'window')
    window_.tool.setWidth(48)
    await nextTick()

    expect(setup().tool.widthIn.value).toBe(30)
    expect(setup([makeWall()], 'window').tool.widthIn.value).toBe(48)
  })

  it('clamps the placement so the opening stays within the segment', () => {
    const { tool, commit } = setup()

    tool.onClick({ x: 5, y: 1 })
    expect(commit.mock.calls[0][0].t).toBe(16)
  })

  it('does not commit when no wall is within reach', () => {
    const { tool, commit } = setup()

    tool.onClick(OFF_WALL)
    expect(commit).not.toHaveBeenCalled()
  })

  it('restores the last-used options in a new instance', async () => {
    const { tool } = setup()
    tool.setWidth(36)
    tool.setStyle('bifold')
    tool.setHinge('right')
    tool.setSwing('out')
    await nextTick()

    const restored = setup().tool
    expect(restored.widthIn.value).toBe(36)
    expect(restored.style.value).toBe('bifold')
    expect(restored.hinge.value).toBe('right')
    expect(restored.swing.value).toBe('out')
  })

  it('places the armed style, flowing it into the ghost and the commit', () => {
    const { tool, commit } = setup()
    tool.setStyle('double')

    tool.setCursor(ABOVE_WALL)
    expect(tool.preview.value?.style).toBe('double')

    tool.onClick(ABOVE_WALL)
    expect(commit.mock.calls[0][0].style).toBe('double')
  })

  it('places a 60" closet slider with the typed width', () => {
    const { tool, commit } = setup()
    tool.setStyle('sliding')
    tool.setCursor(ABOVE_WALL)
    for (const key of ['6', '0']) tool.handleKey(key)
    tool.handleKey('Enter')

    tool.onClick(ABOVE_WALL)
    expect(commit.mock.calls[0][0]).toMatchObject({ style: 'sliding', width_in: 60 })
  })

  it('arms the double bifold at its 60" default width and remembers it as last-used', async () => {
    const { tool, commit } = setup()
    expect(tool.widthIn.value).toBe(DEFAULT_DOOR_WIDTH_IN)

    tool.setStyle('double_bifold')
    expect(tool.widthIn.value).toBe(60)

    tool.setCursor(ABOVE_WALL)
    expect(tool.preview.value).toMatchObject({ style: 'double_bifold', width_in: 60 })

    tool.onClick(ABOVE_WALL)
    expect(commit.mock.calls[0][0]).toMatchObject({ style: 'double_bifold', width_in: 60 })
    await nextTick()
    const restored = setup().tool
    expect(restored.style.value).toBe('double_bifold')
    expect(restored.widthIn.value).toBe(60)
  })

  it('lets a width typed after the style win over the style default', () => {
    const { tool } = setup()
    tool.setStyle('double_bifold')

    tool.setCursor(ABOVE_WALL)
    for (const key of ['4', '8']) tool.handleKey(key)
    tool.handleKey('Enter')

    expect(tool.widthIn.value).toBe(48)
    expect(tool.preview.value?.width_in).toBe(48)
  })

  it('leaves the armed width alone for a style that implies none', () => {
    const { tool } = setup()
    tool.setWidth(30)

    tool.setStyle('bifold')

    expect(tool.widthIn.value).toBe(30)
  })

  it('keeps the window width out of reach of a door style default', async () => {
    const { tool } = setup([makeWall()], 'window')

    tool.setStyle('double_bifold')

    expect(tool.widthIn.value).toBe(DEFAULT_WINDOW_WIDTH_IN)
    await nextTick()
    expect(setup().tool.widthIn.value).toBe(60)
  })

  it('leaves the swing untouched by the cursor for a style that ignores it', async () => {
    const { tool, commit } = setup()
    tool.setSwing('in')
    tool.setStyle('pocket')

    tool.setCursor(BELOW_WALL)
    expect(tool.preview.value?.swing).toBe('in')
    expect(tool.swing.value).toBe('in')

    tool.onClick(BELOW_WALL)
    expect(commit.mock.calls[0][0].swing).toBe('in')
    await nextTick()
    expect(setup().tool.swing.value).toBe('in')
  })

  it('still follows the cursor for the styles whose leaves have a room side', () => {
    const { tool } = setup()
    tool.setStyle('double')

    tool.setCursor(BELOW_WALL)
    expect(tool.preview.value?.swing).toBe('out')

    tool.setStyle('bifold')
    expect(tool.preview.value?.swing).toBe('out')

    tool.setStyle('double_bifold')
    expect(tool.preview.value?.swing).toBe('out')
  })

  it('consumes Tab without writing a hinge side the style ignores', () => {
    const { tool } = setup()
    tool.setStyle('double')
    tool.setCursor(ABOVE_WALL)

    expect(tool.handleKey('Tab')).toBe(true)
    expect(tool.hinge.value).toBe('left')
  })

  it('falls back to the swing style when the stored style is unknown', () => {
    window.localStorage.setItem(
      'floor-plan:opening-tool-options',
      JSON.stringify({ doorStyle: 'barn' }),
    )

    expect(setup().tool.style.value).toBe('swing')
  })

  it('records the cursor-driven swing of a placed door as last-used', async () => {
    const { tool } = setup()
    tool.onClick(BELOW_WALL)
    await nextTick()

    expect(setup().tool.swing.value).toBe('out')
  })

  it('falls back to the defaults when the stored options are corrupted', () => {
    window.localStorage.setItem('floor-plan:opening-tool-options', '{not json')

    const { tool } = setup()
    expect(tool.widthIn.value).toBe(DEFAULT_DOOR_WIDTH_IN)
    expect(tool.hinge.value).toBe('left')
    expect(tool.swing.value).toBe('in')
  })
})
