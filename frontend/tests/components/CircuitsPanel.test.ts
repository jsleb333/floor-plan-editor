import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import CircuitsPanel from '@/components/editor/CircuitsPanel.vue'
import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import { makeCircuit, makeDocument } from '../helpers/planFactory'

/** Mounts the panel over a two-circuit plan: "Kitchen" then "Data". */
function mountPanel(): VueWrapper {
  const store = useEditorStore()
  store.document = makeDocument({
    circuits: [
      makeCircuit({ id: 'kitchen', name: 'Kitchen' }),
      makeCircuit({ id: 'data', name: 'Data', kind: 'data', color: '#2563eb' }),
    ],
  })
  return mount(CircuitsPanel)
}

describe('CircuitsPanel per-circuit visibility (spec C6)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('gives every circuit two separately labelled toggles, both pressed by default', () => {
    const wrapper = mountPanel()

    for (const label of [
      'Hide Kitchen wires',
      'Hide Kitchen devices',
      'Hide Data wires',
      'Hide Data devices',
    ]) {
      const button = wrapper.get(`[aria-label="${label}"]`)
      expect(button.attributes('aria-pressed')).toBe('true')
    }
  })

  it('hides only the wires axis on a plain click, and re-labels itself', async () => {
    const wrapper = mountPanel()
    const layers = useLayersStore()

    await wrapper.get('[aria-label="Hide Kitchen wires"]').trigger('click')

    expect(layers.isCircuitAxisVisible('kitchen', 'wires')).toBe(false)
    expect(layers.isCircuitAxisVisible('kitchen', 'devices')).toBe(true)
    expect(layers.isCircuitAxisVisible('data', 'wires')).toBe(true)
    const button = wrapper.get('[aria-label="Show Kitchen wires"]')
    expect(button.attributes('aria-pressed')).toBe('false')
  })

  it('hides only the devices axis on a plain click', async () => {
    const wrapper = mountPanel()
    const layers = useLayersStore()

    await wrapper.get('[aria-label="Hide Kitchen devices"]').trigger('click')

    expect(layers.isCircuitAxisVisible('kitchen', 'devices')).toBe(false)
    expect(layers.isCircuitAxisVisible('kitchen', 'wires')).toBe(true)
  })

  it('flips both axes together on a shift-click, either way round', async () => {
    const wrapper = mountPanel()
    const layers = useLayersStore()

    await wrapper.get('[aria-label="Hide Kitchen devices"]').trigger('click', { shiftKey: true })

    expect(layers.isCircuitAxisVisible('kitchen', 'wires')).toBe(false)
    expect(layers.isCircuitAxisVisible('kitchen', 'devices')).toBe(false)
    expect(layers.isCircuitAxisVisible('data', 'wires')).toBe(true)

    await wrapper.get('[aria-label="Show Kitchen wires"]').trigger('click', { shiftKey: true })

    expect(layers.isCircuitAxisVisible('kitchen', 'wires')).toBe(true)
    expect(layers.isCircuitAxisVisible('kitchen', 'devices')).toBe(true)
  })

  it('explains the shift-click shortcut in the panel help text', () => {
    expect(mountPanel().text()).toContain('shift-click either toggle')
  })
})

describe('CircuitsPanel active circuit vs isolation (specs W1/C5)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('makes a circuit active on a row click without isolating it', async () => {
    const wrapper = mountPanel()
    const store = useEditorStore()

    await wrapper.get('[aria-label="Make Data the active circuit"]').trigger('click')

    expect(store.activeCircuitId).toBe('data')
    expect(store.isolatedCircuitId).toBeNull()
  })

  it('marks the active row pressed, and only that one', async () => {
    const wrapper = mountPanel()

    await wrapper.get('[aria-label="Make Data the active circuit"]').trigger('click')

    expect(
      wrapper.get('[aria-label="Make Data the active circuit"]').attributes('aria-pressed'),
    ).toBe('true')
    expect(
      wrapper.get('[aria-label="Make Kitchen the active circuit"]').attributes('aria-pressed'),
    ).toBe('false')
  })

  it('isolates from its own button — a separate control that also makes the row active', async () => {
    const wrapper = mountPanel()
    const store = useEditorStore()

    await wrapper.get('[aria-label="Isolate Kitchen"]').trigger('click')

    expect(store.isolatedCircuitId).toBe('kitchen')
    expect(store.activeCircuitId).toBe('kitchen')
    const toggle = wrapper.get('[aria-label="Exit Kitchen isolation"]')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('Isolated')
  })

  it('exits isolation on a second press, keeping the circuit active', async () => {
    const wrapper = mountPanel()
    const store = useEditorStore()

    await wrapper.get('[aria-label="Isolate Kitchen"]').trigger('click')
    await wrapper.get('[aria-label="Exit Kitchen isolation"]').trigger('click')

    expect(store.isolatedCircuitId).toBeNull()
    expect(store.activeCircuitId).toBe('kitchen')
    expect(wrapper.get('[aria-label="Isolate Kitchen"]').attributes('aria-pressed')).toBe('false')
  })

  it('leaves isolation untouched when another row is clicked', async () => {
    const wrapper = mountPanel()
    const store = useEditorStore()

    await wrapper.get('[aria-label="Isolate Kitchen"]').trigger('click')
    await wrapper.get('[aria-label="Make Data the active circuit"]').trigger('click')

    expect(store.activeCircuitId).toBe('data')
    expect(store.isolatedCircuitId).toBe('kitchen')
  })
})
