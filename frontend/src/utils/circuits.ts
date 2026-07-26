import { DEVICE_CATALOG, effectiveDeviceLoad, isSourceType } from '@/devices/catalog'
import type {
  CircuitLoad,
  ControlLink,
  Device,
  PlanDocument,
  PlanValidation,
  Wire,
} from '@/types/plan'

/**
 * Client mirror of the backend circuit validation (spec C4/C5/W4, §8).
 *
 * The server (`GET /api/plans/{id}/validation`) stays the single source of
 * truth for tests and tooling, but live editing must not wait on round trips,
 * so this module recomputes the SAME result from the in-memory document —
 * connectivity BFS from every source device per circuit, load summation with
 * the override > plan-default > catalog precedence, and the 80 %/100 %
 * thresholds. Pure functions only, mirroring `CircuitValidationService`
 * semantics exactly.
 *
 * A SOURCE is any type whose catalog row is flagged `is_source`: the panel, or
 * a feed from another floor for a storey with no panel of its own. Sources root
 * the graph and are excluded from every device-level finding, so a feed's own
 * `load_w` override never reaches a circuit sum — it is documentary on this
 * plan, recording what the feed draws where it actually originates.
 */

/** Continuous-load rule of thumb: warn at or above 80 % of the breaker (spec C4). */
export const CONTINUOUS_LOAD_FACTOR = 0.8

/**
 * A curated, distinguishable palette matching the hand-drawn plan's colours
 * (spec C2). New circuits take the first unused entry, so two circuits never
 * share a colour until the palette is exhausted.
 */
export const CIRCUIT_PALETTE: readonly string[] = [
  '#dc2626', // red
  '#2563eb', // blue
  '#16a34a', // green
  '#ea580c', // orange
  '#9333ea', // purple
  '#0d9488', // teal
  '#db2777', // magenta
  '#92400e', // brown
  '#808000', // olive
  '#1e3a8a', // navy
  '#fb7185', // coral
  '#475569', // slate
]

/** Case-insensitive normalisation so `#FFF000` and `#fff000` count as one colour. */
function normalizeColor(color: string): string {
  return color.trim().toLowerCase()
}

/**
 * The next circuit colour: the first palette entry not already used (spec C2),
 * falling back to cycling the palette by index once every colour is taken.
 *
 * @param usedColors Colours already assigned to circuits.
 * @param count The current circuit count, used for the exhausted-palette cycle.
 */
export function pickNextCircuitColor(usedColors: Iterable<string>, count: number): string {
  const used = new Set<string>()
  for (const color of usedColors) used.add(normalizeColor(color))
  const free = CIRCUIT_PALETTE.find((color) => !used.has(normalizeColor(color)))
  return free ?? CIRCUIT_PALETTE[count % CIRCUIT_PALETTE.length]
}

/** Whether a device type carries any electrical relevance (load or voltage, spec C5). */
function isPoweredType(type: Device['type']): boolean {
  const entry = DEVICE_CATALOG[type]
  return entry.default_load_w > 0 || entry.voltage_v !== null
}

/** Partitions wires into valid ones and the ids of those referencing a missing entity. */
function splitWires(
  wires: readonly Wire[],
  deviceIds: ReadonlySet<string>,
  circuitIds: ReadonlySet<string>,
): { valid: Wire[]; dangling: string[] } {
  const valid: Wire[] = []
  const dangling: string[] = []
  for (const wire of wires) {
    if (
      circuitIds.has(wire.circuit_id) &&
      deviceIds.has(wire.from_device_id) &&
      deviceIds.has(wire.to_device_id)
    ) {
      valid.push(wire)
    } else {
      dangling.push(wire.id)
    }
  }
  return { valid, dangling: dangling.sort() }
}

/**
 * Splits a circuit's wired devices into source-reachable (connected) and
 * unreachable (floating) sets via BFS over the wire graph (spec W4). Source
 * devices are the roots and appear in neither set.
 */
function connectivity(
  circuitWires: readonly Wire[],
  sourceIds: ReadonlySet<string>,
): { connected: Set<string>; floating: Set<string> } {
  const adjacency = new Map<string, Set<string>>()
  const wired = new Set<string>()
  const link = (a: string, b: string): void => {
    const neighbours = adjacency.get(a) ?? new Set<string>()
    neighbours.add(b)
    adjacency.set(a, neighbours)
  }
  for (const wire of circuitWires) {
    link(wire.from_device_id, wire.to_device_id)
    link(wire.to_device_id, wire.from_device_id)
    wired.add(wire.from_device_id)
    wired.add(wire.to_device_id)
  }

  const reachable = new Set<string>()
  const queue: string[] = []
  for (const id of sourceIds) {
    if (wired.has(id)) {
      reachable.add(id)
      queue.push(id)
    }
  }
  for (let head = 0; head < queue.length; head++) {
    for (const neighbour of adjacency.get(queue[head]) ?? []) {
      if (!reachable.has(neighbour)) {
        reachable.add(neighbour)
        queue.push(neighbour)
      }
    }
  }

  const connected = new Set<string>()
  const floating = new Set<string>()
  for (const id of wired) {
    if (sourceIds.has(id)) continue
    if (reachable.has(id)) connected.add(id)
    else floating.add(id)
  }
  return { connected, floating }
}

/** Rates an amperage against a breaker rating (spec C4). */
function loadStatus(amps: number, breakerA: number): CircuitLoad['status'] {
  if (amps > breakerA) return 'over'
  if (amps >= CONTINUOUS_LOAD_FACTOR * breakerA) return 'warning'
  return 'ok'
}

/** Sorted device ids of the set, for deterministic output matching the backend. */
function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort()
}

/**
 * Validates the electrical layout of a plan document (spec C4/C5/W4), returning
 * the same shape as the backend `PlanValidation`. Data/low-voltage circuits
 * carry no load (`amps` is `null`); floating devices are excluded from load
 * sums; loads resolve with the override > plan-default > catalog precedence.
 *
 * @param document The plan document to validate.
 */
export function validatePlan(document: PlanDocument): PlanValidation {
  const devices = document.devices ?? []
  const circuits = document.circuits ?? []
  const wires = document.wires ?? []
  const deviceIds = new Set(devices.map((device) => device.id))
  const circuitIds = new Set(circuits.map((circuit) => circuit.id))
  const devicesById = new Map(devices.map((device) => [device.id, device]))
  const sourceIds = new Set(
    devices.filter((device) => isSourceType(device.type)).map((device) => device.id),
  )

  const { valid, dangling } = splitWires(wires, deviceIds, circuitIds)

  const circuitLoads: CircuitLoad[] = circuits.map((circuit) => {
    const circuitWires = valid.filter((wire) => wire.circuit_id === circuit.id)
    const { connected, floating } = connectivity(circuitWires, sourceIds)
    if (circuit.kind !== 'power') {
      return {
        circuit_id: circuit.id,
        load_w: 0,
        amps: null,
        breaker_a: circuit.breaker_a,
        status: 'ok',
        connected_device_ids: sortedIds(connected),
        floating_device_ids: sortedIds(floating),
      }
    }
    let loadW = 0
    for (const id of connected) {
      const device = devicesById.get(id)
      if (device) loadW += effectiveDeviceLoad(device, document.catalog_defaults)
    }
    const amps = loadW / circuit.voltage_v
    return {
      circuit_id: circuit.id,
      load_w: loadW,
      amps,
      breaker_a: circuit.breaker_a,
      status: loadStatus(amps, circuit.breaker_a),
      connected_device_ids: sortedIds(connected),
      floating_device_ids: sortedIds(floating),
    }
  })

  const wiredIds = new Set<string>()
  for (const wire of valid) {
    wiredIds.add(wire.from_device_id)
    wiredIds.add(wire.to_device_id)
  }

  const unassigned: string[] = []
  for (const device of devices) {
    if (isSourceType(device.type) || wiredIds.has(device.id)) continue
    if (isPoweredType(device.type)) unassigned.push(device.id)
  }

  const circuitsByDevice = new Map<string, Set<string>>()
  for (const wire of valid) {
    for (const id of [wire.from_device_id, wire.to_device_id]) {
      if (sourceIds.has(id)) continue
      const set = circuitsByDevice.get(id) ?? new Set<string>()
      set.add(wire.circuit_id)
      circuitsByDevice.set(id, set)
    }
  }
  const multiCircuit: Record<string, string[]> = {}
  for (const [id, set] of [...circuitsByDevice.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (set.size > 1) multiCircuit[id] = sortedIds(set)
  }

  return {
    circuits: circuitLoads,
    unassigned_device_ids: unassigned.sort(),
    multi_circuit_device_ids: multiCircuit,
    dangling_wire_ids: dangling,
    has_source: sourceIds.size > 0,
  }
}

/** The kind of control link a switch pairing creates: 3-way pairs vs. plain control (spec D6). */
export function controlLinkKind(
  switchType: Device['type'],
  targetType: Device['type'],
): ControlLink['kind'] {
  return switchType === 'switch_3way' && targetType === 'switch_3way'
    ? 'three_way_pair'
    : 'controls'
}
