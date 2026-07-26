import { request } from '@/api/client'
import type { Plan, PlanDocument, PlanSummary } from '@/types/plan'

export async function listPlans(): Promise<PlanSummary[]> {
  return request<PlanSummary[]>('/plans')
}

/**
 * Optional `POST /api/plans` fields, mirroring the backend `PlanCreateRequest`:
 * the home-page creation card seeds the description, the uploaded underlay
 * photo and the tier-2 plan settings in one call (spec P5/§5.9). Omitted
 * fields keep the server defaults.
 */
export interface PlanCreateOptions {
  description?: string
  underlay_asset_id?: string
  thickness_presets_in?: number[]
  display_precision_in?: number
}

export async function createPlan(name: string, options: PlanCreateOptions = {}): Promise<Plan> {
  return request<Plan>('/plans', { method: 'POST', body: { name, ...options } })
}

/** Partial metadata update for `PATCH /api/plans/{id}`; omitted fields are left unchanged. */
export interface PlanMetadataPatch {
  name?: string
  description?: string
}

export async function updatePlanMetadata(id: string, patch: PlanMetadataPatch): Promise<Plan> {
  return request<Plan>(`/plans/${id}`, { method: 'PATCH', body: patch })
}

export async function getPlan(id: string): Promise<Plan> {
  return request<Plan>(`/plans/${id}`)
}

export async function savePlanDocument(
  id: string,
  payload: { revision: number; document: PlanDocument },
): Promise<{ revision: number }> {
  return request<{ revision: number }>(`/plans/${id}`, { method: 'PUT', body: payload })
}

export async function duplicatePlan(id: string): Promise<Plan> {
  return request<Plan>(`/plans/${id}/duplicate`, { method: 'POST' })
}

export async function archivePlan(id: string): Promise<Plan> {
  return request<Plan>(`/plans/${id}/archive`, { method: 'POST' })
}

export async function restorePlan(id: string): Promise<Plan> {
  return request<Plan>(`/plans/${id}/restore`, { method: 'POST' })
}

export async function deletePlan(id: string): Promise<void> {
  await request<undefined>(`/plans/${id}`, { method: 'DELETE' })
}
