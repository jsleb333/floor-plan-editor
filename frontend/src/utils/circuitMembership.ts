import { isSourceType } from '@/devices/catalog'
import type { Circuit, Device, PlanValidation } from '@/types/plan'

/**
 * Device → circuit(s) resolution, derived from a `PlanValidation` (spec C2/C3/C6).
 *
 * Membership is already implied by `validatePlan`'s per-circuit
 * `connected_device_ids` / `floating_device_ids`; this module turns that
 * circuit-major view into the device-major one the canvas, the export and the
 * per-circuit visibility toggles all need, plus the ONE colour rule those views
 * must agree on. It only READS the validation — never recomputes it — so the
 * backend-mirrored semantics of `utils/circuits.ts`, pinned by the shared
 * fixture corpus, stay entirely out of scope here.
 *
 * A device belongs to a circuit when it appears in EITHER of that circuit's
 * sets: a floating device IS on the circuit, it just does not reach a source —
 * the Circuits panel's amber warning communicates that, not the colour.
 */

/**
 * Maps every device id to the circuits it belongs to, in DOCUMENT ORDER.
 *
 * Devices on no circuit are simply absent from the map. Sources (panel, feed
 * up/down) never appear either: `validatePlan` keeps them out of both
 * membership sets by design, being the roots that belong to every circuit.
 *
 * @param validation The validation to read membership from.
 * @param circuits The document's circuits, in document order; a circuit with no
 *     matching validation entry contributes nothing.
 *
 * @returns Device id → its circuits, ordered exactly as `circuits` is.
 */
export function circuitsByDevice(
  validation: PlanValidation,
  circuits: readonly Circuit[],
): Map<string, Circuit[]> {
  const loadByCircuit = new Map(validation.circuits.map((load) => [load.circuit_id, load]))
  const membership = new Map<string, Circuit[]>()
  for (const circuit of circuits) {
    const load = loadByCircuit.get(circuit.id)
    if (!load) continue
    for (const deviceId of [...load.connected_device_ids, ...load.floating_device_ids]) {
      const existing = membership.get(deviceId)
      if (existing) existing.push(circuit)
      else membership.set(deviceId, [circuit])
    }
  }
  return membership
}

/**
 * The circuit colour a device draws in, or `null` when it draws in plain ink —
 * the single rule `DevicesLayer` and the SVG export share, so a printed plan
 * reads exactly like the screen (spec C2/C6).
 *
 * A device on MORE THAN ONE circuit is legitimate (spec C3: e.g. a network jack
 * on both a power and a data pseudo-circuit). It takes the colour of the FIRST
 * circuit in DOCUMENT ORDER — the same circuit the panel lists first — so the
 * choice is stable and predictable rather than depending on wiring order.
 *
 * Sources (panel, feed up/down) always return `null`: they belong to every
 * circuit, so colouring them by one would be meaningless. Visibility toggles
 * never enter into it either — colour is the circuit's identity, not its state.
 *
 * @param device The device to colour.
 * @param membership The map from `circuitsByDevice`.
 */
export function deviceCircuitColor(
  device: Device,
  membership: ReadonlyMap<string, readonly Circuit[]>,
): string | null {
  if (isSourceType(device.type)) return null
  return membership.get(device.id)?.[0]?.color ?? null
}
