import type { Asset } from '@/types/asset'
import type { Plan, PlanDocument, PlanSummary } from '@/types/plan'

export { ApiError } from '@/api/client'

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

/** Partial metadata update for `PATCH /api/plans/{id}`; omitted fields are left unchanged. */
export interface PlanMetadataPatch {
  name?: string
  description?: string
}

/**
 * A URL bound to an asset's bytes, valid until {@link AssetUrlHandle.release} is
 * called. The REST backend hands out a permanent path and `release` is a no-op;
 * a browser backend hands out an object URL that leaks until released. Callers
 * must release in the same scope that resolved the handle.
 */
export interface AssetUrlHandle {
  readonly url: string
  release(): void
}

/**
 * Plan persistence, backend-agnostic (REST today, IndexedDB in a future static
 * build). Every method rejects with an {@link ApiError} whose `status` matches
 * the REST contract, because callers branch on it: 404 for an unknown plan,
 * 409 for a stale revision or a permanent-delete of a live plan
 * (`frontend/src/stores/editor.ts` checks `.status === 409`).
 */
export interface PlansPort {
  listPlans(): Promise<PlanSummary[]>
  createPlan(name: string, options?: PlanCreateOptions): Promise<Plan>
  getPlan(id: string): Promise<Plan>
  savePlanDocument(
    id: string,
    payload: { revision: number; document: PlanDocument },
  ): Promise<{ revision: number }>
  updatePlanMetadata(id: string, patch: PlanMetadataPatch): Promise<Plan>
  duplicatePlan(id: string): Promise<Plan>
  archivePlan(id: string): Promise<Plan>
  restorePlan(id: string): Promise<Plan>
  deletePlan(id: string): Promise<void>
}

/** Asset persistence, backend-agnostic (REST today, IndexedDB in a future static build). */
export interface AssetsPort {
  uploadAsset(file: File): Promise<Asset>
  resolveAssetUrl(id: string): Promise<AssetUrlHandle>
  readAssetBlob(id: string): Promise<Blob>
}
