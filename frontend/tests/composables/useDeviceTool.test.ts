import { beforeEach, describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'
import type { Ref } from 'vue'

import { useDeviceTool } from '@/composables/useDeviceTool'
import type { UseDeviceToolReturn } from '@/composables/useDeviceTool'
import type { SnapSettings } from '@/composables/useSnapping'
import type { Device, DeviceType, Wall } from '@/types/plan'
import { makeWall } from '../helpers/planFactory'

describe('useDeviceTool', () => {
  let snapSettings: SnapSettings
  let armedType: Ref<DeviceType | null>
  let committed: Device[]

  function setup(walls: Wall[], type: DeviceType | null = 'outlet'): UseDeviceToolReturn {
    committed = []
    armedType = ref<DeviceType | null>(type)
    return useDeviceTool({
      armedType,
      walls: computed(() => walls),
      pixelsPerInch: ref(2),
      snapSettings,
      commit: (device) => committed.push(device),
    })
  }

  beforeEach(() => {
    snapSettings = { grid: ref(false), angle: ref(true), walls: ref(true) }
  })

  it('previews a wall device on the cursor side of the nearest wall', () => {
    const tool = setup([makeWall({ id: 'w' })])
    tool.setCursor({ x: 60, y: -3 })

    const preview = tool.preview.value
    expect(preview?.attachment).toEqual({ wall_id: 'w', segment_index: 0, t: 60, side: 'left' })
    expect(preview?.position).toBeNull()
  })

  it('commits a device with a fresh id on click and stays armed', () => {
    const tool = setup([makeWall({ id: 'w' })])
    tool.setCursor({ x: 60, y: 3 })
    tool.onClick({ x: 60, y: 3 })

    expect(committed).toHaveLength(1)
    expect(committed[0].id).not.toBe('device-preview')
    expect(committed[0].attachment?.side).toBe('right')
    expect(armedType.value).toBe('outlet')
  })

  it('previews a free device at the grid-snapped cursor when grid snap is on', () => {
    snapSettings.grid.value = true
    const tool = setup([], 'ceiling_light')
    tool.setCursor({ x: 61, y: 41 })

    expect(tool.preview.value?.position).toEqual({ x: 60, y: 42 })
    expect(tool.preview.value?.attachment).toBeNull()
  })

  it('shows temporary dimensions to the segment ends of the host wall (spec S2a)', () => {
    const tool = setup([makeWall({ id: 'w' })])
    tool.setCursor({ x: 40, y: -2 })

    const chips = tool.chips.value
    expect(chips.map((chip) => chip.side)).toEqual(['left', 'right'])
    expect(chips[0].distanceIn).toBeCloseTo(40, 6)
    expect(chips[1].distanceIn).toBeCloseTo(80, 6)
  })

  it('positions exactly from the active side when a length is typed then Enter', () => {
    const tool = setup([makeWall({ id: 'w' })])
    tool.setCursor({ x: 40, y: -2 })
    for (const key of ['2', '4']) tool.handleKey(key)

    expect(tool.handleKey('Enter')).toBe(true)
    expect(committed).toHaveLength(1)
    // Left feature is the segment start (t=0); typed 24" → t = 24.
    expect(committed[0].attachment?.t).toBeCloseTo(24, 6)
  })

  it('Tab switches the active side the typed value applies to', () => {
    const tool = setup([makeWall({ id: 'w' })])
    tool.setCursor({ x: 40, y: -2 })
    expect(tool.handleKey('Tab')).toBe(true)
    for (const key of ['2', '4']) tool.handleKey(key)
    tool.handleKey('Enter')

    // Right feature is the segment end (t=120); typed 24" → t = 96.
    expect(committed[0].attachment?.t).toBeCloseTo(96, 6)
  })

  it('Escape disarms to the picker, then is not consumed a second time', () => {
    const tool = setup([makeWall({ id: 'w' })])
    expect(tool.handleKey('Escape')).toBe(true)
    expect(armedType.value).toBeNull()
    expect(tool.handleKey('Escape')).toBe(false)
  })
})
