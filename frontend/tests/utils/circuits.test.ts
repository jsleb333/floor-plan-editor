import { describe, expect, it } from 'vitest'

import type { Circuit, Device, Wire } from '@/types/plan'
import {
  CIRCUIT_PALETTE,
  controlLinkKind,
  pickNextCircuitColor,
  validatePlan,
} from '@/utils/circuits'
import { makeCircuit, makeDevice, makeDocument, makeWire } from '../helpers/planFactory'

/** A free-standing device of a type (attachment irrelevant to validation). */
function device(id: string, type: Device['type'], overrides: Partial<Device> = {}): Device {
  return makeDevice({ id, type, attachment: null, position: { x: 0, y: 0 }, ...overrides })
}

function wire(id: string, from: string, to: string, circuitId = 'c'): Wire {
  return makeWire({ id, circuit_id: circuitId, from_device_id: from, to_device_id: to })
}

function powerCircuit(overrides: Partial<Circuit> = {}): Circuit {
  return makeCircuit({ id: 'c', kind: 'power', voltage_v: 120, breaker_a: 15, ...overrides })
}

describe('validatePlan', () => {
  it('sums the load of the devices connected to the panel', () => {
    const document = makeDocument({
      circuits: [powerCircuit()],
      devices: [device('p', 'panel'), device('o1', 'outlet'), device('o2', 'outlet')],
      wires: [wire('w1', 'p', 'o1'), wire('w2', 'o1', 'o2')],
    })

    const load = validatePlan(document).circuits[0]
    expect(load.load_w).toBe(360)
    expect(load.amps).toBeCloseTo(3, 6)
    expect(load.status).toBe('ok')
    expect(load.connected_device_ids).toEqual(['o1', 'o2'])
    expect(load.floating_device_ids).toEqual([])
  })

  it('excludes floating devices (not reaching the panel) from the load sum (spec W4)', () => {
    const document = makeDocument({
      circuits: [powerCircuit()],
      devices: [device('p', 'panel'), device('o1', 'outlet'), device('o2', 'outlet')],
      // o1<->o2 are wired to each other but never to the panel.
      wires: [wire('w1', 'o1', 'o2')],
    })

    const load = validatePlan(document).circuits[0]
    expect(load.load_w).toBe(0)
    expect(load.connected_device_ids).toEqual([])
    expect(load.floating_device_ids).toEqual(['o1', 'o2'])
  })

  it('warns at exactly 80% of the breaker (12.0 A on a 15 A breaker)', () => {
    const document = makeDocument({
      circuits: [powerCircuit({ breaker_a: 15, voltage_v: 120 })],
      devices: [device('p', 'panel'), device('x', 'outlet', { load_w: 1440 })],
      wires: [wire('w1', 'p', 'x')],
    })

    const load = validatePlan(document).circuits[0]
    expect(load.amps).toBeCloseTo(12, 6)
    expect(load.status).toBe('warning')
  })

  it('flags over-capacity above 100% of the breaker', () => {
    const document = makeDocument({
      circuits: [powerCircuit({ breaker_a: 15, voltage_v: 120 })],
      devices: [device('p', 'panel'), device('x', 'outlet', { load_w: 1900 })],
      wires: [wire('w1', 'p', 'x')],
    })

    const load = validatePlan(document).circuits[0]
    expect(load.amps).toBeGreaterThan(15)
    expect(load.status).toBe('over')
  })

  it('reports no load and null amps for a data circuit even with a load-bearing device', () => {
    const document = makeDocument({
      circuits: [powerCircuit({ kind: 'data' })],
      devices: [device('p', 'panel'), device('o1', 'outlet')],
      wires: [wire('w1', 'p', 'o1')],
    })

    const load = validatePlan(document).circuits[0]
    expect(load.load_w).toBe(0)
    expect(load.amps).toBeNull()
    expect(load.status).toBe('ok')
    expect(load.connected_device_ids).toEqual(['o1'])
  })

  it('resolves loads with override > plan-default > catalog precedence', () => {
    const document = makeDocument({
      catalog_defaults: { baseboard_heater: 750 },
      circuits: [powerCircuit({ voltage_v: 240, breaker_a: 30 })],
      devices: [
        device('p', 'panel'),
        device('a', 'baseboard_heater', { load_w: 500 }), // override wins
        device('b', 'baseboard_heater'), // plan default 750
        device('d', 'ceiling_light'), // catalog default 15
      ],
      wires: [wire('w1', 'p', 'a'), wire('w2', 'a', 'b'), wire('w3', 'b', 'd')],
    })

    const load = validatePlan(document).circuits[0]
    expect(load.load_w).toBe(500 + 750 + 15)
  })

  it('roots the BFS at a feed when the plan has no panel of its own', () => {
    const document = makeDocument({
      circuits: [powerCircuit()],
      devices: [device('f', 'feed_down'), device('o1', 'outlet'), device('o2', 'outlet')],
      wires: [wire('w1', 'f', 'o1'), wire('w2', 'o1', 'o2')],
    })

    const result = validatePlan(document)
    expect(result.has_source).toBe(true)
    expect(result.circuits[0].connected_device_ids).toEqual(['o1', 'o2'])
    expect(result.circuits[0].floating_device_ids).toEqual([])
    expect(result.circuits[0].load_w).toBe(360)
  })

  it("keeps a feed's own load override out of the circuit sum (documentary only)", () => {
    const document = makeDocument({
      circuits: [powerCircuit()],
      devices: [device('f', 'feed_up', { load_w: 3000 }), device('o1', 'outlet')],
      wires: [wire('w1', 'f', 'o1')],
    })

    const load = validatePlan(document).circuits[0]
    expect(load.connected_device_ids).toEqual(['o1'])
    expect(load.load_w).toBe(180)
  })

  it('never reports a feed as unassigned or multi-circuit, exactly like the panel', () => {
    const document = makeDocument({
      circuits: [powerCircuit({ id: 'c' }), powerCircuit({ id: 'c2' })],
      devices: [
        device('f', 'feed_down', { load_w: 1500 }),
        device('lonely-feed', 'feed_up', { load_w: 2000 }),
        device('o1', 'outlet'),
        device('o2', 'outlet'),
      ],
      wires: [wire('w1', 'f', 'o1', 'c'), wire('w2', 'f', 'o2', 'c2')],
    })

    const result = validatePlan(document)
    expect(result.unassigned_device_ids).toEqual([])
    expect(result.multi_circuit_device_ids).toEqual({})
  })

  it('lists unassigned powered devices, multi-circuit devices, dangling wires and source presence', () => {
    const document = makeDocument({
      circuits: [powerCircuit({ id: 'c' }), powerCircuit({ id: 'c2' })],
      devices: [
        device('p', 'panel'),
        device('o1', 'outlet'),
        device('lonely', 'outlet'),
        device('sw', 'switch'), // no load, no voltage → not "unassigned"
      ],
      wires: [
        wire('w1', 'p', 'o1', 'c'),
        wire('w2', 'p', 'o1', 'c2'), // o1 wired to two circuits
        wire('bad', 'p', 'ghost', 'c'), // dangling (missing device)
      ],
    })

    const result = validatePlan(document)
    expect(result.has_source).toBe(true)
    expect(result.unassigned_device_ids).toEqual(['lonely'])
    expect(result.multi_circuit_device_ids).toEqual({ o1: ['c', 'c2'] })
    expect(result.dangling_wire_ids).toEqual(['bad'])
  })
})

describe('pickNextCircuitColor', () => {
  it('returns the first palette colour when none are used', () => {
    expect(pickNextCircuitColor([], 0)).toBe(CIRCUIT_PALETTE[0])
  })

  it('skips colours already in use, case-insensitively (spec C2)', () => {
    expect(pickNextCircuitColor([CIRCUIT_PALETTE[0].toUpperCase()], 1)).toBe(CIRCUIT_PALETTE[1])
  })

  it('cycles the palette by index once every colour is taken', () => {
    expect(pickNextCircuitColor(CIRCUIT_PALETTE, CIRCUIT_PALETTE.length)).toBe(CIRCUIT_PALETTE[0])
  })
})

describe('controlLinkKind', () => {
  it('pairs two 3-way switches, otherwise a plain control link (spec D6)', () => {
    expect(controlLinkKind('switch_3way', 'switch_3way')).toBe('three_way_pair')
    expect(controlLinkKind('switch', 'ceiling_light')).toBe('controls')
    expect(controlLinkKind('switch_3way', 'ceiling_light')).toBe('controls')
  })
})
