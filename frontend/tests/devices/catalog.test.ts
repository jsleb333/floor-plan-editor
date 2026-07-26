import { describe, expect, it } from 'vitest'

import {
  DEVICE_CATALOG,
  DEVICE_GROUPS,
  DEVICE_TYPES,
  deviceFootprint,
  effectiveDefaultLoad,
  effectiveDeviceFootprint,
  effectiveDeviceLoad,
  isSourceType,
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
  'feed_up',
  'feed_down',
]

describe('device catalog', () => {
  it('covers every device type exactly once (17/17)', () => {
    expect(DEVICE_TYPES).toHaveLength(17)
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

  it('gives the inter-floor feeds a wall mount and no load of their own', () => {
    for (const type of ['feed_up', 'feed_down'] as const) {
      expect(DEVICE_CATALOG[type]).toMatchObject({
        mount: 'wall',
        voltage_v: null,
        default_load_w: 0,
        group: 'sources',
      })
    }
  })
})

describe('isSourceType', () => {
  it('flags exactly the connectivity roots: the panel and the two feeds (spec C1/W4)', () => {
    expect(DEVICE_TYPES.filter(isSourceType)).toEqual(['panel', 'feed_up', 'feed_down'])
  })
})

describe('device groups', () => {
  it('assigns a non-empty group to every device type', () => {
    for (const type of DEVICE_TYPES) {
      expect(DEVICE_CATALOG[type].group).toBeTruthy()
    }
  })

  it('gives every declared group at least one device type', () => {
    for (const group of DEVICE_GROUPS) {
      const membersOf = DEVICE_TYPES.filter((type) => DEVICE_CATALOG[type].group === group.id)
      expect(membersOf.length).toBeGreaterThan(0)
    }
  })
})

describe('device footprints', () => {
  /** The sized types and their inches, mirroring the backend catalog rows (spec D2). */
  const SIZED: Readonly<Record<string, readonly [number, number]>> = {
    baseboard_heater: [36, 3],
    water_heater: [22, 22],
    central_vacuum: [14, 14],
    air_exchanger: [30, 20],
    panel: [14, 4],
  }

  it('gives the physically sized types their default along/across size', () => {
    for (const [type, [along, across]] of Object.entries(SIZED)) {
      expect(deviceFootprint(type as DeviceType)).toEqual({
        along_in: along,
        across_in: across,
      })
    }
  })

  it('leaves every other type symbolic, with no footprint at all', () => {
    for (const type of DEVICE_TYPES) {
      if (type in SIZED) continue
      expect(deviceFootprint(type)).toBeNull()
    }
  })
})

describe('effectiveDeviceFootprint', () => {
  it('falls back to the catalog footprint when neither override is set', () => {
    expect(effectiveDeviceFootprint(makeDevice({ type: 'water_heater' }))).toEqual({
      along_in: 22,
      across_in: 22,
    })
  })

  it('prefers a per-device override over the catalog footprint, dimension by dimension', () => {
    expect(
      effectiveDeviceFootprint(makeDevice({ type: 'baseboard_heater', length_in: 72 })),
    ).toEqual({ along_in: 72, across_in: 3 })
    expect(effectiveDeviceFootprint(makeDevice({ type: 'baseboard_heater', depth_in: 5 }))).toEqual(
      {
        along_in: 36,
        across_in: 5,
      },
    )
  })

  it('ignores a non-positive override, exactly like a blank field', () => {
    expect(effectiveDeviceFootprint(makeDevice({ type: 'panel', length_in: 0 }))).toEqual({
      along_in: 14,
      across_in: 4,
    })
  })

  it('is null for a symbolic type, whose size is the nominal pictogram box', () => {
    expect(effectiveDeviceFootprint(makeDevice({ type: 'switch', length_in: 40 }))).toBeNull()
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
