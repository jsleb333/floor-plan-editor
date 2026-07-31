import { request } from '@/api/client'
import type { PlanCreateOptions, PlanMetadataPatch, PlansPort } from '@/persistence/ports'
import type { Plan, PlanDocument, PlanSummary } from '@/types/plan'

export async function listPlans(): Promise<PlanSummary[]> {
  return request<PlanSummary[]>('/plans')
}

export async function createPlan(name: string, options: PlanCreateOptions = {}): Promise<Plan> {
  return request<Plan>('/plans', { method: 'POST', body: { name, ...options } })
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

export const restPlansPort: PlansPort = {
  listPlans,
  createPlan,
  getPlan,
  savePlanDocument,
  updatePlanMetadata,
  duplicatePlan,
  archivePlan,
  restorePlan,
  deletePlan,
}
