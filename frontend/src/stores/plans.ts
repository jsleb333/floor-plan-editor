import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  archivePlan,
  createPlan,
  deletePlan,
  duplicatePlan,
  getPlan,
  listPlans,
  restorePlan,
  savePlanDocument,
  updatePlanMetadata,
} from '@/persistence/plans'
import type { PlanCreateOptions, PlanMetadataPatch } from '@/persistence/plans'
import type { Plan, PlanDocument, PlanSummary } from '@/types/plan'

function toSummary(plan: Plan): PlanSummary {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
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

  /**
   * Creates a plan, optionally seeded by the creation card (spec P5): a
   * description, an uploaded underlay photo and the tier-2 defaults.
   */
  async function create(name: string, options: PlanCreateOptions = {}): Promise<Plan> {
    const plan = await createPlan(name, options)
    plans.value = [toSummary(plan), ...plans.value]
    return plan
  }

  /** Patches a plan's name and/or description (spec P5); omitted fields are unchanged. */
  async function updateMetadata(id: string, patch: PlanMetadataPatch): Promise<Plan> {
    const plan = await updatePlanMetadata(id, patch)
    replaceSummary(plan)
    return plan
  }

  async function rename(id: string, name: string): Promise<Plan> {
    return updateMetadata(id, { name })
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
    updateMetadata,
    rename,
    duplicate,
    archive,
    restore,
    remove,
    getDocument,
    importPlan,
  }
})
