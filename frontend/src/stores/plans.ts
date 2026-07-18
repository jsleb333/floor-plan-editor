import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  archivePlan,
  createPlan,
  deletePlan,
  duplicatePlan,
  getPlan,
  listPlans,
  renamePlan,
  restorePlan,
  savePlanDocument,
} from '@/api/plans'
import type { Plan, PlanDocument, PlanSummary } from '@/types/plan'

function toSummary(plan: Plan): PlanSummary {
  return {
    id: plan.id,
    name: plan.name,
    updated_at: plan.updated_at,
    archived_at: plan.archived_at,
  }
}

/** Home-page plan list: fetches, caches and mutates plan metadata via the API. */
export const usePlansStore = defineStore('plans', () => {
  const plans = ref<PlanSummary[]>([])
  // One in-flight fetch per plan id backs the card thumbnails (spec §5.1 P1):
  // repeated requests for the same id share the promise, so a plan's full
  // document is fetched at most once. Failed fetches drop out so they can retry.
  const documentPromises = new Map<string, Promise<PlanDocument>>()

  function replaceSummary(plan: Plan): void {
    plans.value = plans.value.map((p) => (p.id === plan.id ? toSummary(plan) : p))
  }

  /** Fetches a plan's full document, cached per id for thumbnail rendering. */
  function getDocument(id: string): Promise<PlanDocument> {
    const cached = documentPromises.get(id)
    if (cached) return cached
    const promise = getPlan(id)
      .then((plan) => plan.document)
      .catch((error: unknown) => {
        documentPromises.delete(id)
        throw error
      })
    documentPromises.set(id, promise)
    return promise
  }

  /**
   * Creates a plan from an imported document (spec X1): creates it by name,
   * then replaces its document via the autosave `PUT`. Returns the new plan.
   */
  async function importPlan(name: string, document: PlanDocument): Promise<Plan> {
    const plan = await createPlan(name)
    await savePlanDocument(plan.id, { revision: plan.revision, document })
    const imported: Plan = { ...plan, document }
    plans.value = [toSummary(imported), ...plans.value]
    documentPromises.set(plan.id, Promise.resolve(document))
    return imported
  }

  async function load(): Promise<PlanSummary[]> {
    plans.value = await listPlans()
    return plans.value
  }

  async function create(name: string): Promise<Plan> {
    const plan = await createPlan(name)
    plans.value = [toSummary(plan), ...plans.value]
    return plan
  }

  async function rename(id: string, name: string): Promise<Plan> {
    const plan = await renamePlan(id, name)
    replaceSummary(plan)
    return plan
  }

  async function duplicate(id: string): Promise<Plan> {
    const plan = await duplicatePlan(id)
    plans.value = [toSummary(plan), ...plans.value]
    return plan
  }

  async function archive(id: string): Promise<Plan> {
    const plan = await archivePlan(id)
    replaceSummary(plan)
    return plan
  }

  async function restore(id: string): Promise<Plan> {
    const plan = await restorePlan(id)
    replaceSummary(plan)
    return plan
  }

  async function remove(id: string): Promise<void> {
    await deletePlan(id)
    plans.value = plans.value.filter((p) => p.id !== id)
  }

  return {
    plans,
    load,
    create,
    rename,
    duplicate,
    archive,
    restore,
    remove,
    getDocument,
    importPlan,
  }
})
