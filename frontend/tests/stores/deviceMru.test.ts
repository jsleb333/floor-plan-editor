import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useDeviceMruStore } from '@/stores/deviceMru'

describe('useDeviceMruStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('floats the most-recently-used type to the front, de-duplicated', () => {
    const store = useDeviceMruStore()
    store.record('outlet')
    store.record('switch')
    store.record('outlet')

    expect(store.recent).toEqual(['outlet', 'switch'])
  })

  it('caps the list and persists it across store instances', () => {
    const store = useDeviceMruStore()
    for (const type of [
      'outlet',
      'switch',
      'ceiling_light',
      'wall_light',
      'thermostat',
      'panel',
      'network_jack',
    ] as const) {
      store.record(type)
    }

    expect(store.recent).toHaveLength(6)
    expect(store.recent[0]).toBe('network_jack')
    expect(store.recent).not.toContain('outlet')

    setActivePinia(createPinia())
    const reloaded = useDeviceMruStore()
    expect(reloaded.recent).toEqual(store.recent)
  })
})
