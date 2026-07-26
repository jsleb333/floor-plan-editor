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
