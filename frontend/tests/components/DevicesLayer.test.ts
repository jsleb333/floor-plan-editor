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
  it('registers one symbol per device type (17/17)', () => {
    const wrapper = mount(DevicePictogram)
    const ids = wrapper.findAll('symbol').map((symbol) => symbol.attributes('id'))
    expect(ids).toHaveLength(17)
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

  it('renders a baseboard heater as its own oriented rectangle plus an inscribed glyph', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [makeWall()],
      devices: [makeDevice({ id: 'd1', type: 'baseboard_heater', length_in: 36 })],
    })

    const wrapper = mount(DevicesLayer, { props: { hairline: 0.5, pixelsPerInch: 2 } })
    // Left face at y = -1.75 on a 3.5" wall; the 36" x 3" rect protrudes into the room.
    expect(wrapper.find('polygon').attributes('points')).toBe('42,-1.75 78,-1.75 78,-4.75 42,-4.75')
    expect(wrapper.find('use').attributes('href')).toBe(`#${pictogramSymbolId('baseboard_heater')}`)
  })

  it('renders a free water heater at its true 22x22 size, glyph inscribed at the centre', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      devices: [
        makeDevice({
          id: 'd1',
          type: 'water_heater',
          attachment: null,
          position: { x: 0, y: 0 },
        }),
      ],
    })

    const wrapper = mount(DevicesLayer, { props: { hairline: 0.5, pixelsPerInch: 2 } })
    expect(wrapper.find('polygon').attributes('points')).toBe('-11,-11 11,-11 11,11 -11,11')
    expect(wrapper.find('use').attributes('transform')).toBe('translate(0 0) rotate(0) scale(1)')
  })

  it('D4: zooming out shrinks the footprint rectangle but clamps only the glyph', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      devices: [
        makeDevice({
          id: 'd1',
          type: 'water_heater',
          attachment: null,
          position: { x: 0, y: 0 },
        }),
      ],
    })

    const wrapper = mount(DevicesLayer, { props: { hairline: 0.5, pixelsPerInch: 0.5 } })
    // The rectangle keeps its real world size — it is meant to shrink on screen.
    expect(wrapper.find('polygon').attributes('points')).toBe('-11,-11 11,-11 11,11 -11,11')
    // The glyph counter-scales to stay legible (14 px floor over a 6 px box).
    expect(wrapper.find('use').attributes('transform')).toContain(`scale(${14 / 6})`)
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
