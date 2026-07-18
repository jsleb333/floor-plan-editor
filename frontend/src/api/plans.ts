import { request } from '@/api/client'
import type { Plan, PlanDocument, PlanSummary, PlanValidation } from '@/types/plan'

export async function listPlans(): Promise<PlanSummary[]> {
  return request<PlanSummary[]>('/plans')
}

export async function createPlan(name: string): Promise<Plan> {
  return request<Plan>('/plans', { method: 'POST', body: { name } })
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

/**
 * Fetches the server-computed circuit validation (spec C4/C5/W4). The backend
 * is the single source of truth; the frontend mirrors this live during editing
 * via `utils/circuits.ts` for instant feedback (spec §8).
 */
export async function getPlanValidation(id: string): Promise<PlanValidation> {
  return request<PlanValidation>(`/plans/${id}/validation`)
}

export async function renamePlan(id: string, name: string): Promise<Plan> {
  return request<Plan>(`/plans/${id}`, { method: 'PATCH', body: { name } })
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
