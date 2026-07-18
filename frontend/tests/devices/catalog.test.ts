import { describe, expect, it } from 'vitest'

import {
  DEVICE_CATALOG,
  DEVICE_TYPES,
  effectiveDefaultLoad,
  effectiveDeviceLoad,
  searchDeviceTypes,
} from '@/devices/catalog'
import type { DeviceType } from '@/types/plan'
import { makeDevice } from '../helpers/planFactory'

/** The committed backend DeviceType union — the frontend catalog must cover it 1:1. */
const BACKEND_TYPES: readonly DeviceType[] = [
  'outlet',
  'outlet_gfci',
  'switch',
  'switch_3way',
  'ceiling_light',
  'wall_light',
  'baseboard_heater',
  'thermostat',
  'water_heater',
  'air_exchanger',
  'central_vacuum',
  'vacuum_inlet',
  'smoke_detector',
  'network_jack',
  'panel',
]

describe('device catalog', () => {
  it('covers every device type exactly once (15/15)', () => {
    expect(DEVICE_TYPES).toHaveLength(15)
    expect(new Set(DEVICE_TYPES)).toEqual(new Set(BACKEND_TYPES))
    for (const type of BACKEND_TYPES) {
      expect(DEVICE_CATALOG[type]).toBeDefined()
    }
  })

  it('mirrors the backend catalog mounts and default loads', () => {
    expect(DEVICE_CATALOG.outlet).toMatchObject({
      mount: 'wall',
      voltage_v: 120,
      default_load_w: 180,
    })
    expect(DEVICE_CATALOG.baseboard_heater).toMatchObject({
      mount: 'wall',
      voltage_v: 240,
      default_load_w: 1000,
    })
    expect(DEVICE_CATALOG.water_heater).toMatchObject({
      mount: 'free',
      voltage_v: 240,
      default_load_w: 3800,
    })
    expect(DEVICE_CATALOG.smoke_detector.mount).toBe('ceiling')
    expect(DEVICE_CATALOG.switch.voltage_v).toBeNull()
  })
})

describe('effectiveDefaultLoad', () => {
  it('prefers a plan-level override over the catalog default', () => {
    expect(effectiveDefaultLoad('baseboard_heater', {})).toEqual({ value: 1000, source: 'catalog' })
    expect(effectiveDefaultLoad('baseboard_heater', { baseboard_heater: 750 })).toEqual({
      value: 750,
      source: 'plan',
    })
  })
})

describe('effectiveDeviceLoad', () => {
  it('uses the per-device override, else the effective default', () => {
    expect(effectiveDeviceLoad(makeDevice({ type: 'baseboard_heater', load_w: 1500 }), {})).toBe(
      1500,
    )
    expect(effectiveDeviceLoad(makeDevice({ type: 'baseboard_heater', load_w: null }), {})).toBe(
      1000,
    )
    expect(
      effectiveDeviceLoad(makeDevice({ type: 'baseboard_heater', load_w: null }), {
        baseboard_heater: 750,
      }),
    ).toBe(750)
  })
})

describe('searchDeviceTypes', () => {
  it('returns every type in catalog order for an empty query', () => {
    expect(searchDeviceTypes('')).toEqual(DEVICE_TYPES)
  })

  it('matches labels, French legends and search terms, labels first', () => {
    expect(searchDeviceTypes('gfci')).toEqual(['outlet_gfci'])
    expect(searchDeviceTypes('prise')).toEqual(
      expect.arrayContaining(['outlet', 'outlet_gfci', 'vacuum_inlet']),
    )
    expect(searchDeviceTypes('breaker')).toEqual(['panel'])
    expect(searchDeviceTypes('zzz')).toEqual([])
  })
})
