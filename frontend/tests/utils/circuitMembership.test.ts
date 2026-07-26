import { describe, expect, it } from 'vitest'

import type { Circuit, Device, PlanDocument, PlanValidation, Wire } from '@/types/plan'
import { circuitsByDevice, deviceCircuitColor } from '@/utils/circuitMembership'
import { validatePlan } from '@/utils/circuits'
import { makeCircuit, makeDevice, makeDocument, makeWire } from '../helpers/planFactory'

const RED = '#dc2626'
const BLUE = '#2563eb'

/** A free-standing device of a type (placement is irrelevant to membership). */
function device(id: string, type: Device['type']): Device {
  return makeDevice({ id, type, attachment: null, position: { x: 0, y: 0 } })
}

function wire(id: string, from: string, to: string, circuitId: string): Wire {
  return makeWire({ id, circuit_id: circuitId, from_device_id: from, to_device_id: to })
}

/** Membership resolved the way the app does it: straight off `validatePlan`. */
function membershipOf(document: PlanDocument): Map<string, Circuit[]> {
  return circuitsByDevice(validatePlan(document), document.circuits)
}

/** Circuit ids per device, the readable form for assertions. */
function idsOf(membership: ReadonlyMap<string, readonly Circuit[]>): Record<string, string[]> {
  return Object.fromEntries(
    [...membership].map(([deviceId, circuits]) => [deviceId, circuits.map((c) => c.id)]),
  )
}

describe('circuitsByDevice', () => {
  it('maps every device wired to a source onto its circuit', () => {
    const document = makeDocument({
      circuits: [makeCircuit({ id: 'power' })],
      devices: [device('p', 'panel'), device('o1', 'outlet'), device('o2', 'outlet')],
      wires: [wire('w1', 'p', 'o1', 'power'), wire('w2', 'o1', 'o2', 'power')],
    })

    expect(idsOf(membershipOf(document))).toEqual({ o1: ['power'], o2: ['power'] })
  })

  it('counts a FLOATING device as a member of its circuit (spec W4)', () => {
    const document = makeDocument({
      circuits: [makeCircuit({ id: 'power' })],
      // o1<->o2 are wired to each other but never reach the panel.
      devices: [device('p', 'panel'), device('o1', 'outlet'), device('o2', 'outlet')],
      wires: [wire('w1', 'o1', 'o2', 'power')],
    })
    const validation = validatePlan(document)

    expect(validation.circuits[0].connected_device_ids).toEqual([])
    expect(validation.circuits[0].floating_device_ids).toEqual(['o1', 'o2'])
    expect(idsOf(membershipOf(document))).toEqual({ o1: ['power'], o2: ['power'] })
  })

  it('omits devices on no circuit and omits the sources, which belong to every circuit', () => {
    const document = makeDocument({
      circuits: [makeCircuit({ id: 'power' })],
      devices: [
        device('p', 'panel'),
        device('f', 'feed_up'),
        device('o1', 'outlet'),
        device('lonely', 'outlet'),
      ],
      wires: [wire('w1', 'p', 'o1', 'power'), wire('w2', 'f', 'o1', 'power')],
    })

    const membership = membershipOf(document)
    expect(membership.has('p')).toBe(false)
    expect(membership.has('f')).toBe(false)
    expect(membership.has('lonely')).toBe(false)
    expect(idsOf(membership)).toEqual({ o1: ['power'] })
  })

  it('lists a multi-circuit device in DOCUMENT order, whichever order it was wired in', () => {
    const circuits = [
      makeCircuit({ id: 'power', color: RED }),
      makeCircuit({ id: 'data', name: 'Data', kind: 'data', color: BLUE }),
    ]
    const devices = [device('p', 'panel'), device('jack', 'network_jack')]
    // The data wire is drawn FIRST, so wiring order and document order disagree.
    const wires = [wire('w2', 'p', 'jack', 'data'), wire('w1', 'p', 'jack', 'power')]

    expect(idsOf(membershipOf(makeDocument({ circuits, devices, wires })))).toEqual({
      jack: ['power', 'data'],
    })
    expect(
      idsOf(membershipOf(makeDocument({ circuits: [...circuits].reverse(), devices, wires }))),
    ).toEqual({ jack: ['data', 'power'] })
  })

  it('ignores validation entries for circuits absent from the list', () => {
    const validation: PlanValidation = {
      circuits: [
        {
          circuit_id: 'ghost',
          load_w: 0,
          amps: null,
          breaker_a: 15,
          status: 'ok',
          connected_device_ids: ['o1'],
          floating_device_ids: [],
        },
      ],
      unassigned_device_ids: [],
      multi_circuit_device_ids: {},
      dangling_wire_ids: [],
      has_source: true,
    }

    expect(circuitsByDevice(validation, [makeCircuit({ id: 'power' })]).size).toBe(0)
  })
})

describe('deviceCircuitColor', () => {
  it("returns the circuit's colour for a device on it, connected or floating (spec C2)", () => {
    const document = makeDocument({
      circuits: [makeCircuit({ id: 'power', color: RED })],
      devices: [
        device('p', 'panel'),
        device('o1', 'outlet'),
        device('o2', 'outlet'),
        device('o3', 'outlet'),
      ],
      // o1 reaches the panel; o2<->o3 float on the same circuit.
      wires: [wire('w1', 'p', 'o1', 'power'), wire('w2', 'o2', 'o3', 'power')],
    })
    const membership = membershipOf(document)

    expect(deviceCircuitColor(document.devices[1], membership)).toBe(RED)
    expect(deviceCircuitColor(document.devices[2], membership)).toBe(RED)
    expect(deviceCircuitColor(document.devices[3], membership)).toBe(RED)
  })

  it('takes the FIRST circuit in document order for a multi-circuit device (spec C3)', () => {
    const document = makeDocument({
      circuits: [
        makeCircuit({ id: 'power', color: RED }),
        makeCircuit({ id: 'data', name: 'Data', kind: 'data', color: BLUE }),
      ],
      devices: [device('p', 'panel'), device('jack', 'network_jack')],
      wires: [wire('w1', 'p', 'jack', 'data'), wire('w2', 'p', 'jack', 'power')],
    })

    expect(deviceCircuitColor(document.devices[1], membershipOf(document))).toBe(RED)
  })

  it('leaves every source uncoloured, even wired into a circuit (spec C1)', () => {
    const document = makeDocument({
      circuits: [makeCircuit({ id: 'power', color: RED })],
      devices: [device('p', 'panel'), device('f', 'feed_down'), device('o1', 'outlet')],
      wires: [wire('w1', 'p', 'o1', 'power'), wire('w2', 'f', 'o1', 'power')],
    })
    const membership = membershipOf(document)

    expect(deviceCircuitColor(document.devices[0], membership)).toBeNull()
    expect(deviceCircuitColor(document.devices[1], membership)).toBeNull()
  })

  it('returns null for a device on no circuit', () => {
    const document = makeDocument({ devices: [device('lonely', 'outlet')] })
    expect(deviceCircuitColor(document.devices[0], membershipOf(document))).toBeNull()
  })
})
