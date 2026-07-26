import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import DeviceInspector from '@/components/editor/DeviceInspector.vue'
import type { Device } from '@/types/plan'

function outlet(id: string): Device {
  return {
    id,
    type: 'outlet',
    attachment: null,
    position: { x: 0, y: 0 },
    rotation_deg: 0,
    label: null,
    load_w: null,
    length_in: null,
    depth_in: null,
    notes: null,
  }
}

function mountInspector(devices: readonly Device[]): VueWrapper {
  return mount(DeviceInspector, {
    props: {
      devices,
      walls: [],
      catalogDefaults: {},
      allDevices: devices,
      controlLinks: [],
      armedControlLinkSwitchId: null,
    },
  })
}

describe('DeviceInspector', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // Vue casts a `v-model` on `type="number"` to a number, so the handlers must
  // not assume a string — typing a wattage used to throw on `.trim()`.
  it('applies a typed load override on a single device', async () => {
    const wrapper = mountInspector([outlet('a')])

    const input = wrapper.get('input[aria-label="Load override in watts"]')
    await input.setValue('240')
    await input.trigger('blur')

    expect(wrapper.emitted('update-device')?.at(-1)).toEqual([
      expect.objectContaining({ id: 'a', load_w: 240 }),
    ])
  })

  it('clears the load override back to the default when emptied', async () => {
    const wrapper = mountInspector([outlet('a')])

    const input = wrapper.get('input[aria-label="Load override in watts"]')
    await input.setValue('240')
    await input.trigger('blur')
    await input.setValue('')
    await input.trigger('blur')

    expect(wrapper.emitted('update-device')?.at(-1)).toEqual([
      expect.objectContaining({ id: 'a', load_w: null }),
    ])
  })

  it('offers no dimension fields for a symbolic type', () => {
    const wrapper = mountInspector([outlet('a')])

    expect(wrapper.find('[aria-label="Device dimensions"]').exists()).toBe(false)
  })

  it('edits both footprint dimensions of any sized device, in feet and inches', async () => {
    const heater: Device = { ...outlet('wh'), type: 'water_heater' }
    const wrapper = mountInspector([heater])

    const length = wrapper.get('input[aria-label="Device length in feet and inches"]')
    const depth = wrapper.get('input[aria-label="Device depth in feet and inches"]')
    // Placeholders show the effective size — here the 22" x 22" catalog footprint.
    expect(length.attributes('placeholder')).toBe('1\'10"')
    expect(depth.attributes('placeholder')).toBe('1\'10"')

    await length.setValue("2'6")
    await length.trigger('blur')
    await depth.setValue('18')
    await depth.trigger('blur')

    expect(wrapper.emitted('update-device')?.at(-2)).toEqual([
      expect.objectContaining({ id: 'wh', length_in: 30 }),
    ])
    expect(wrapper.emitted('update-device')?.at(-1)).toEqual([
      expect.objectContaining({ id: 'wh', depth_in: 18 }),
    ])
  })

  it('shows the per-device override, not the catalog default, as the dimension placeholder', () => {
    const heater: Device = { ...outlet('bb'), type: 'baseboard_heater', length_in: 48 }
    const wrapper = mountInspector([heater])

    expect(
      wrapper.get('input[aria-label="Device length in feet and inches"]').attributes('placeholder'),
    ).toBe('4\'0"')
  })

  it('keeps the baseboard wattage presets alongside the dimensions', () => {
    const heater: Device = { ...outlet('bb'), type: 'baseboard_heater' }
    const wrapper = mountInspector([heater])

    wrapper.get('[aria-label="Device dimensions"]')
    expect(wrapper.findAll('[aria-label="Wattage presets"] button')).toHaveLength(6)
  })

  it('lets a feed carry a load override but says it is documentary here', async () => {
    const feed: Device = { ...outlet('f'), type: 'feed_down' }
    const wrapper = mountInspector([feed])

    const input = wrapper.get('input[aria-label="Load override in watts"]')
    await input.setValue('3000')
    await input.trigger('blur')

    expect(wrapper.emitted('update-device')?.at(-1)).toEqual([
      expect.objectContaining({ id: 'f', load_w: 3000 }),
    ])
    expect(wrapper.text()).toContain('documentary')
    expect(mountInspector([outlet('a')]).text()).not.toContain('documentary')
  })

  it('applies a typed load override to every device in a multi selection', async () => {
    const wrapper = mountInspector([outlet('a'), outlet('b')])

    const input = wrapper.get('input[aria-label="Bulk load override in watts"]')
    await input.setValue('180')
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('bulk-update-devices')?.at(-1)).toEqual([
      [
        expect.objectContaining({ id: 'a', load_w: 180 }),
        expect.objectContaining({ id: 'b', load_w: 180 }),
      ],
    ])
  })
})
