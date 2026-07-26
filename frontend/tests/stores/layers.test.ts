import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useLayersStore } from '@/stores/layers'

describe('useLayersStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('defaults every layer and every circuit axis to visible, with nothing registered', () => {
    const store = useLayersStore()

    expect(store.structureVisible).toBe(true)
    expect(store.devicesVisible).toBe(true)
    expect(store.annotationsVisible).toBe(true)
    expect(store.hiddenWireCircuitIds.size).toBe(0)
    expect(store.hiddenDeviceCircuitIds.size).toBe(0)
    // A circuit created after this point needs no registration to be visible.
    expect(store.isCircuitAxisVisible('brand-new', 'wires')).toBe(true)
    expect(store.isCircuitAxisVisible('brand-new', 'devices')).toBe(true)
  })

  it('hides wires and devices independently on the same circuit (spec C6)', () => {
    const store = useLayersStore()

    store.setCircuitAxisVisible('c1', 'wires', false)

    expect(store.isCircuitAxisVisible('c1', 'wires')).toBe(false)
    expect(store.isCircuitAxisVisible('c1', 'devices')).toBe(true)
    expect(store.hiddenWireCircuitIds).toEqual(new Set(['c1']))
    expect(store.hiddenDeviceCircuitIds.size).toBe(0)

    store.setCircuitAxisVisible('c1', 'devices', false)
    store.setCircuitAxisVisible('c1', 'wires', true)

    expect(store.isCircuitAxisVisible('c1', 'wires')).toBe(true)
    expect(store.isCircuitAxisVisible('c1', 'devices')).toBe(false)
  })

  it('keeps circuits independent of one another', () => {
    const store = useLayersStore()

    store.setCircuitAxisVisible('c1', 'devices', false)

    expect(store.isCircuitAxisVisible('c2', 'devices')).toBe(true)
  })

  it('toggles one axis back and forth without touching the other', () => {
    const store = useLayersStore()

    store.toggleCircuitAxis('c1', 'devices')
    expect(store.isCircuitAxisVisible('c1', 'devices')).toBe(false)
    expect(store.isCircuitAxisVisible('c1', 'wires')).toBe(true)

    store.toggleCircuitAxis('c1', 'devices')
    expect(store.isCircuitAxisVisible('c1', 'devices')).toBe(true)
    expect(store.hiddenDeviceCircuitIds.size).toBe(0)
  })

  it('replaces the hidden set on every change so watchers and computeds re-run', () => {
    const store = useLayersStore()
    const before = store.hiddenWireCircuitIds

    store.setCircuitAxisVisible('c1', 'wires', false)

    expect(store.hiddenWireCircuitIds).not.toBe(before)
  })
})
