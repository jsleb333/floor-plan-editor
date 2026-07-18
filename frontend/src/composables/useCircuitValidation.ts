import { computed } from 'vue'
import type { ComputedRef } from 'vue'

import { useEditorStore } from '@/stores/editor'
import type { CircuitLoad, PlanValidation } from '@/types/plan'
import { validatePlan } from '@/utils/circuits'

const EMPTY_VALIDATION: PlanValidation = {
  circuits: [],
  unassigned_device_ids: [],
  multi_circuit_device_ids: {},
  dangling_wire_ids: [],
  has_panel: false,
}

export interface UseCircuitValidationReturn {
  /** The live client-mirrored validation of the open plan (spec C4/C5/W4, §8). */
  validation: ComputedRef<PlanValidation>
  /** Per-circuit load keyed by circuit id, for O(1) lookup in list rows. */
  loadByCircuit: ComputedRef<Map<string, CircuitLoad>>
  /** How many circuits are in `warning` or `over` state (the Circuits tab badge, §6.1). */
  warningCount: ComputedRef<number>
}

/**
 * Live circuit validation mirrored from the open plan document (spec §8). The
 * server endpoint stays the source of truth, but this drives the Circuits panel
 * and the tab warning badge without a round trip, recomputing whenever the
 * document changes.
 */
export function useCircuitValidation(): UseCircuitValidationReturn {
  const editorStore = useEditorStore()

  const validation = computed<PlanValidation>(() => {
    void editorStore.documentVersion
    const document = editorStore.document
    return document ? validatePlan(document) : EMPTY_VALIDATION
  })

  const loadByCircuit = computed<Map<string, CircuitLoad>>(
    () => new Map(validation.value.circuits.map((load) => [load.circuit_id, load])),
  )

  const warningCount = computed(
    () => validation.value.circuits.filter((load) => load.status !== 'ok').length,
  )

  return { validation, loadByCircuit, warningCount }
}
