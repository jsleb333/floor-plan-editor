import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import DevicePictogram from '@/components/editor/DevicePictogram.vue'
import DevicesLayer from '@/components/editor/DevicesLayer.vue'
import { DEVICE_TYPES } from '@/devices/catalog'
import { pictogramSymbolId } from '@/devices/pictograms'
import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import { makeDevice, makeDocument, makeWall } from '../helpers/planFactory'

describe('DevicePictogram', () => {
  it('registers one symbol per device type (15/15)', () => {
    const wrapper = mount(DevicePictogram)
    const ids = wrapper.findAll('symbol').map((symbol) => symbol.attributes('id'))
    expect(ids).toHaveLength(15)
    expect(new Set(ids)).toEqual(new Set(DEVICE_TYPES.map(pictogramSymbolId)))
  })
})

describe('DevicesLayer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders an attached device as a <use> referencing its symbol', () => {
    const store = useEditorStore()
    store.document = makeDocument({ walls: [makeWall()], devices: [makeDevice({ id: 'd1' })] })

    const wrapper = mount(DevicesLayer, { props: { hairline: 0.5, pixelsPerInch: 2 } })
    const use = wrapper.find('use')
    expect(use.exists()).toBe(true)
    expect(use.attributes('href')).toBe(`#${pictogramSymbolId('outlet')}`)
    expect(use.attributes('transform')).toContain('translate')
  })

  it('renders a baseboard heater as its own oriented rectangle, not a <use>', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [makeWall()],
      devices: [makeDevice({ id: 'd1', type: 'baseboard_heater', length_in: 36 })],
    })

    const wrapper = mount(DevicesLayer, { props: { hairline: 0.5, pixelsPerInch: 2 } })
    expect(wrapper.find('use').exists()).toBe(false)
    expect(wrapper.find('polygon').exists()).toBe(true)
  })

  it('hides all devices when the devices layer is toggled off', async () => {
    const store = useEditorStore()
    store.document = makeDocument({ walls: [makeWall()], devices: [makeDevice({ id: 'd1' })] })
    const layers = useLayersStore()

    const wrapper = mount(DevicesLayer, { props: { hairline: 0.5, pixelsPerInch: 2 } })
    expect(wrapper.find('use').exists()).toBe(true)

    layers.devicesVisible = false
    await wrapper.vm.$nextTick()
    expect(wrapper.find('use').exists()).toBe(false)
  })
})
