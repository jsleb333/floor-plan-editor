import { browserPlansPort } from '@/persistence/browser/browserPlansAdapter'
import type { PlanCreateOptions, PlanMetadataPatch, PlansPort } from '@/persistence/ports'
import { restPlansPort } from '@/persistence/rest/restPlansAdapter'
import type { Plan, PlanDocument, PlanSummary } from '@/types/plan'

/** Chosen at BUILD time; anything other than 'browser' means the REST backend. */
// The ternary reads `import.meta.env.VITE_PERSISTENCE` literally at this site so
// Vite's `define` substitution + esbuild folding + Rollup DCE drop the unused
// adapter — cross-module constant propagation is not guaranteed to do the same.
// Keep it inline: hoisting the comparison into a named constant is what breaks
// the REST build's ability to shed the whole IndexedDB subtree.
const port: PlansPort =
  import.meta.env.VITE_PERSISTENCE === 'browser' ? browserPlansPort : restPlansPort

export function listPlans(): Promise<PlanSummary[]> {
  return port.listPlans()
}

export function createPlan(name: string, options: PlanCreateOptions = {}): Promise<Plan> {
  return port.createPlan(name, options)
}

export function getPlan(id: string): Promise<Plan> {
  return port.getPlan(id)
}

export function savePlanDocument(
  id: string,
  payload: { revision: number; document: PlanDocument },
): Promise<{ revision: number }> {
  return port.savePlanDocument(id, payload)
}

export function updatePlanMetadata(id: string, patch: PlanMetadataPatch): Promise<Plan> {
  return port.updatePlanMetadata(id, patch)
}

export function duplicatePlan(id: string): Promise<Plan> {
  return port.duplicatePlan(id)
}

export function archivePlan(id: string): Promise<Plan> {
  return port.archivePlan(id)
}

export function restorePlan(id: string): Promise<Plan> {
  return port.restorePlan(id)
}

export function deletePlan(id: string): Promise<void> {
  return port.deletePlan(id)
}

export type { PlanCreateOptions, PlanMetadataPatch }
