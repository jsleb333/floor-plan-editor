import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Ref } from 'vue'

/** One independently hideable axis of a circuit: its wires, or its devices (spec C6). */
export type CircuitAxis = 'wires' | 'devices'

/**
 * Session-level layer visibility (spec E7: the Inspector mode's overview).
 *
 * Structure covers walls, openings and stairs; devices cover electrical
 * pictograms; annotations cover labels and dimension lines; guides cover the
 * custom construction lines (spec S9) — hiding them also silences their snap
 * tier, since a guide nobody can see must not capture a cursor. Per-circuit
 * visibility (spec C6) has TWO independent axes — wires and devices — each
 * tracked as the SET OF HIDDEN circuit ids, so circuits default to fully
 * visible and newly created ones need no registration. The underlay's own
 * visibility/lock live in the document (`Underlay.visible`/`locked`); these UI
 * flags are not persisted — document-level layer states arrive with export in
 * M6.
 */
export const useLayersStore = defineStore('layers', () => {
  const structureVisible = ref(true)
  const devicesVisible = ref(true)
  const annotationsVisible = ref(true)
  const guidesVisible = ref(true)
  const hiddenWireCircuitIds = ref<Set<string>>(new Set())
  const hiddenDeviceCircuitIds = ref<Set<string>>(new Set())

  function hiddenIds(axis: CircuitAxis): Ref<Set<string>> {
    return axis === 'wires' ? hiddenWireCircuitIds : hiddenDeviceCircuitIds
  }

  /** Whether one axis of a circuit is shown on the canvas (spec C6). */
  function isCircuitAxisVisible(circuitId: string, axis: CircuitAxis): boolean {
    return !hiddenIds(axis).value.has(circuitId)
  }

  /** Shows or hides one axis of a circuit (spec C6). */
  function setCircuitAxisVisible(circuitId: string, axis: CircuitAxis, visible: boolean): void {
    const target = hiddenIds(axis)
    const next = new Set(target.value)
    if (visible) next.delete(circuitId)
    else next.add(circuitId)
    target.value = next
  }

  /** Toggles one axis of a circuit (spec C6). */
  function toggleCircuitAxis(circuitId: string, axis: CircuitAxis): void {
    setCircuitAxisVisible(circuitId, axis, !isCircuitAxisVisible(circuitId, axis))
  }

  return {
    structureVisible,
    devicesVisible,
    annotationsVisible,
    guidesVisible,
    hiddenWireCircuitIds,
    hiddenDeviceCircuitIds,
    isCircuitAxisVisible,
    setCircuitAxisVisible,
    toggleCircuitAxis,
  }
})
