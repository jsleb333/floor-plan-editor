import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import OpeningsLayer from '@/components/editor/OpeningsLayer.vue'
import { useEditorStore } from '@/stores/editor'
import { makeDocument, makeOpening, makeWall } from '../helpers/planFactory'

describe('OpeningsLayer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders an interruption, jambs and the swing symbol for a door', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [makeWall()],
      openings: [makeOpening({ id: 'door-1' })],
    })

    const wrapper = mount(OpeningsLayer, { props: { hairline: 0.5 } })
    expect(wrapper.findAll('polygon')).toHaveLength(1)
    expect(wrapper.findAll('line')).toHaveLength(2)
    const door = wrapper.find('path')
    expect(door.exists()).toBe(true)
    expect(door.attributes('d')).toContain('A 32 32')
  })

  it('renders glazing lines instead of a swing symbol for a window', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [makeWall()],
      openings: [makeOpening({ id: 'win-1', kind: 'window' })],
    })

    const wrapper = mount(OpeningsLayer, { props: { hairline: 0.5 } })
    expect(wrapper.find('path').exists()).toBe(false)
    // Two jambs + two glazing lines.
    expect(wrapper.findAll('line')).toHaveLength(4)
  })

  it('skips openings whose host wall is missing and applies the selected accent', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [makeWall()],
      openings: [makeOpening({ id: 'door-1' }), makeOpening({ id: 'orphan', wall_id: 'ghost' })],
    })
    store.select([{ kind: 'opening', id: 'door-1' }])

    const wrapper = mount(OpeningsLayer, { props: { hairline: 0.5 } })
    expect(wrapper.findAll('polygon')).toHaveLength(1)
    expect(wrapper.find('path').classes()).toContain('stroke-accent-strong')
  })
})
