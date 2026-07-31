import { ApiError } from '@/api/client'
import { collectOrphanAssets } from '@/persistence/browser/assetGarbageCollector'
import { assetExists } from '@/persistence/browser/assetRecords'
import { createDefaultPlanDocument } from '@/persistence/browser/planDocumentDefaults'
import { requestPersistentStorage } from '@/persistence/browser/storagePersistence'
import {
  backUpAndWriteDocument,
  deletePlanRows,
  insertPlan,
  listPlanRecords,
  patchPlanRecord,
  readStoredPlan,
  setPlanArchivedAt,
  writePlanDocument,
  type PlanRecord,
  type StoredPlan,
} from '@/persistence/browser/planRecords'
import type { PlanCreateOptions, PlanMetadataPatch, PlansPort } from '@/persistence/ports'
import { CURRENT_SCHEMA_VERSION, readPlanDocument } from '@/schema/planDocumentSchema'
import type { Plan, PlanDocument, PlanSummary } from '@/types/plan'

/**
 * {@link PlansPort} backed by the browser's IndexedDB, for the static build
 * that ships without a server.
 *
 * It reproduces `PlanService`'s behaviour, statuses and messages: the same
 * revision arithmetic, the same repair-and-back-up read, the same refusal to
 * permanently delete a plan that was not archived first. Callers cannot tell
 * which adapter is behind the port, which is the point — `@/stores/editor`
 * branches on `.status === 409` to recover from a lost autosave race, and that
 * branch has to fire here too.
 */

const NOT_FOUND_STATUS = 404
const CONFLICT_STATUS = 409

/** Appended to a duplicated plan's name, matching `DUPLICATE_NAME_SUFFIX` server-side. */
const DUPLICATE_NAME_SUFFIX = ' (copy)'

function planNotFound(id: string): ApiError {
  return new ApiError(NOT_FOUND_STATUS, `Plan '${id}' not found.`)
}

function revisionConflict(id: string, expectedRevision: number): ApiError {
  return new ApiError(
    CONFLICT_STATUS,
    `Plan '${id}' was modified concurrently: revision ${expectedRevision} is no longer current.`,
  )
}

/** A fresh plan row: a uuid with dashes, like the backend's `str(uuid4())`. */
function newPlanRecord(name: string, description: string, at: string): PlanRecord {
  return {
    id: crypto.randomUUID(),
    name,
    description,
    revision: 1,
    created_at: at,
    updated_at: at,
    archived_at: null,
  }
}

/**
 * Reads a stored plan, bringing its document up to the current schema version
 * and repairing what cannot be read (`readPlanDocument`).
 *
 * When anything had to change, the document as it was stored is copied into
 * `documentBackups` and the repaired one is persisted, so the repair is paid
 * for once rather than on every open — the same bargain
 * `PlanService._persist_migration` strikes. Losing the revision race with a
 * concurrent write simply abandons the persist and returns the repaired
 * document anyway: the next read will try again.
 */
async function readAndRepair(stored: StoredPlan): Promise<Plan> {
  const read = readPlanDocument(stored.document)
  if (!read.migrated && read.issues.length === 0) {
    return { ...stored.record, document: read.document }
  }
  const now = new Date().toISOString()
  const result = await backUpAndWriteDocument(
    {
      plan_id: stored.record.id,
      from_version: read.fromVersion,
      document: stored.document,
      created_at: now,
    },
    read.document,
    stored.record.revision,
    now,
  )
  if (result.status !== 'written') {
    return { ...stored.record, document: read.document }
  }
  return {
    ...stored.record,
    revision: result.revision,
    updated_at: now,
    document: read.document,
  }
}

/**
 * Every plan, most recently updated first.
 *
 * The order comes from walking the `by_updated_at` index backwards, never from
 * sorting in JS: the home page renders the array as it arrives, and an
 * unindexed sort would quietly become a full scan as a user's plan count grows.
 */
async function listPlans(): Promise<PlanSummary[]> {
  const records = await listPlanRecords()
  return records.map(({ id, name, description, updated_at, archived_at }) => ({
    id,
    name,
    description,
    updated_at,
    archived_at,
  }))
}

/**
 * Creates a plan at revision 1 with the default document, seeded by the
 * creation card's optional fields (spec P5).
 *
 * @throws {ApiError} 404 when `options.underlay_asset_id` names an asset that
 *   was never uploaded; a plan pointing at a missing image would open into a
 *   calibration step with nothing to calibrate.
 */
async function createPlan(name: string, options: PlanCreateOptions = {}): Promise<Plan> {
  const underlayAssetId = options.underlay_asset_id
  if (underlayAssetId !== undefined && !(await assetExists(underlayAssetId))) {
    throw new ApiError(NOT_FOUND_STATUS, `Asset '${underlayAssetId}' not found.`)
  }
  const document = createDefaultPlanDocument(options)
  const record = newPlanRecord(name, options.description ?? '', new Date().toISOString())
  await insertPlan(record, document)
  // The user now has something in this browser worth protecting from eviction,
  // which is the first moment asking for persistence means anything. Never
  // awaited: a permission the browser may decide to prompt for cannot sit in
  // front of a plan the user already created.
  void requestPersistentStorage()
  return { ...record, document }
}

/** A full plan, its document read forward to the current schema version. */
async function getPlan(id: string): Promise<Plan> {
  const stored = await readStoredPlan(id)
  if (stored === null) throw planNotFound(id)
  return readAndRepair(stored)
}

/**
 * Replaces a plan's document (autosave), guarded by the revision the caller
 * last saw.
 *
 * The document is stamped to the current schema version but NOT parsed: this
 * runs on a timer while the user types, and paying Zod for a document the
 * editor itself just produced would tax every keystroke. Validation belongs on
 * the read side, where the data is untrusted.
 *
 * @throws {ApiError} 404 when the plan is gone, 409 when another writer got
 *   there first — the status `@/stores/editor` turns into a reload-and-merge.
 */
async function savePlanDocument(
  id: string,
  payload: { revision: number; document: PlanDocument },
): Promise<{ revision: number }> {
  const stamped: PlanDocument =
    payload.document.schema_version === CURRENT_SCHEMA_VERSION
      ? payload.document
      : { ...payload.document, schema_version: CURRENT_SCHEMA_VERSION }
  const result = await writePlanDocument(id, stamped, payload.revision, new Date().toISOString())
  switch (result.status) {
    case 'written':
      return { revision: result.revision }
    case 'missing':
      throw planNotFound(id)
    case 'conflict':
      throw revisionConflict(id, payload.revision)
  }
}

/**
 * Renames a plan or rewrites its description. The revision is untouched — an
 * inline rename on the home page must not invalidate the revision an editor
 * open in another tab is autosaving against.
 */
async function updatePlanMetadata(id: string, patch: PlanMetadataPatch): Promise<Plan> {
  const updated = await patchPlanRecord(id, patch, new Date().toISOString())
  if (!updated) throw planNotFound(id)
  return getPlan(id)
}

/** Copies a plan's document into a new plan named `<name> (copy)`, at revision 1. */
async function duplicatePlan(id: string): Promise<Plan> {
  const source = await getPlan(id)
  const document = structuredClone(source.document)
  const record = newPlanRecord(
    source.name + DUPLICATE_NAME_SUFFIX,
    source.description,
    new Date().toISOString(),
  )
  await insertPlan(record, document)
  return { ...record, document }
}

/** Soft-deletes a plan by stamping `archived_at`. */
async function archivePlan(id: string): Promise<Plan> {
  const now = new Date().toISOString()
  const updated = await setPlanArchivedAt(id, now, now)
  if (!updated) throw planNotFound(id)
  return getPlan(id)
}

/** Clears a plan's `archived_at`, bringing it back to the active list. */
async function restorePlan(id: string): Promise<Plan> {
  const updated = await setPlanArchivedAt(id, null, new Date().toISOString())
  if (!updated) throw planNotFound(id)
  return getPlan(id)
}

/**
 * Permanently removes an archived plan, and with it the underlay image the plan
 * was the last to reference.
 *
 * Reclaiming the image is what makes this the action the 507 message tells the
 * user to take: a plan's rows are kilobytes, its traced photo is tens of
 * megabytes, and deleting the plan without it would free nothing they can feel.
 * The sweep runs after the deletion has committed and cannot fail it — see
 * `collectOrphanAssets` for why it never rejects.
 *
 * @throws {ApiError} 409 when the plan is not archived: data is never destroyed
 *   without the soft-delete step in front of it.
 */
async function deletePlan(id: string): Promise<void> {
  const plan = await getPlan(id)
  if (plan.archived_at === null) {
    throw new ApiError(CONFLICT_STATUS, `Plan '${id}' must be archived before permanent deletion.`)
  }
  await deletePlanRows(id)
  await collectOrphanAssets()
}

export const browserPlansPort: PlansPort = {
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
