import {
  DOCUMENT_BACKUPS_STORE,
  PLAN_DOCUMENTS_STORE,
  PLANS_STORE,
  UPDATED_AT_INDEX,
  openDb,
} from '@/persistence/browser/db'
import {
  addIfAbsent,
  collectCursor,
  requestResult,
  runTransaction,
} from '@/persistence/browser/idb'
import type { PlanMetadataPatch } from '@/persistence/ports'
import type { PlanDocument } from '@/types/plan'

/**
 * Raw storage operations over the plan stores: rows in, rows out, no domain
 * rules. This is the browser counterpart of `SqlitePlanRepository`, and it
 * mirrors that class's division of labour — the adapter decides what a missing
 * row or a stale revision MEANS, this module only reports which happened.
 */

/** A row of the `plans` store: everything about a plan except its document. */
export interface PlanRecord {
  id: string
  name: string
  description: string
  revision: number
  created_at: string
  updated_at: string
  archived_at: string | null
}

/** A row of the `planDocuments` store; `document` is whatever was stored, unvalidated. */
export interface PlanDocumentRecord {
  id: string
  document: unknown
}

/** A row of the `documentBackups` store: the copy of a document taken before it was repaired. */
export interface DocumentBackupRecord {
  plan_id: string
  from_version: number
  document: unknown
  created_at: string
}

/**
 * A plan as stored. `document` is deliberately `unknown`: it is whatever an
 * older build of the app wrote, and only `readPlanDocument` may say what it is.
 */
export interface StoredPlan {
  record: PlanRecord
  document: unknown
}

/**
 * The outcome of a revision-guarded document write, mirroring what
 * `UPDATE ... WHERE id = ? AND revision = ?` distinguishes: it applied, the
 * plan is gone, or someone else wrote first.
 */
export type DocumentWriteResult =
  { status: 'written'; revision: number } | { status: 'missing' } | { status: 'conflict' }

/** Every plan's metadata, most recently updated first. */
export async function listPlanRecords(): Promise<PlanRecord[]> {
  const db = await openDb()
  return runTransaction(db, PLANS_STORE, 'readonly', (transaction) =>
    collectCursor<PlanRecord>(
      transaction.objectStore(PLANS_STORE).index(UPDATED_AT_INDEX).openCursor(null, 'prev'),
    ),
  )
}

/**
 * A plan's metadata and its stored document, read in one transaction so the two
 * cannot come from different revisions.
 *
 * A metadata row whose document row is missing reads as a document of
 * `undefined`, which `readPlanDocument` turns into an empty plan and one
 * reported issue — repair, not reject, all the way down.
 */
export async function readStoredPlan(id: string): Promise<StoredPlan | null> {
  const db = await openDb()
  return runTransaction(
    db,
    [PLANS_STORE, PLAN_DOCUMENTS_STORE],
    'readonly',
    async (transaction) => {
      const record = await requestResult<PlanRecord | undefined>(
        transaction.objectStore(PLANS_STORE).get(id),
      )
      if (record === undefined) return null
      const row = await requestResult<PlanDocumentRecord | undefined>(
        transaction.objectStore(PLAN_DOCUMENTS_STORE).get(id),
      )
      return { record, document: row?.document }
    },
  )
}

/**
 * Stores a brand new plan and its document together.
 *
 * @throws {ApiError} 409 when the id is already taken; the metadata row is
 *   added rather than put, so a duplicate cannot silently overwrite a plan.
 */
export async function insertPlan(record: PlanRecord, document: PlanDocument): Promise<void> {
  const db = await openDb()
  await runTransaction(
    db,
    [PLANS_STORE, PLAN_DOCUMENTS_STORE],
    'readwrite',
    async (transaction) => {
      await requestResult(transaction.objectStore(PLANS_STORE).add(record))
      await requestResult(
        transaction.objectStore(PLAN_DOCUMENTS_STORE).put({ id: record.id, document }),
      )
    },
  )
}

/**
 * The compare-and-set at the heart of autosave, as IDB requests on an already
 * open transaction: read the revision, and only if it is the expected one write
 * the document and the bumped metadata.
 */
async function commitDocument(
  transaction: IDBTransaction,
  id: string,
  document: PlanDocument,
  expectedRevision: number,
  updatedAt: string,
): Promise<DocumentWriteResult> {
  const record = await requestResult<PlanRecord | undefined>(
    transaction.objectStore(PLANS_STORE).get(id),
  )
  if (record === undefined) return { status: 'missing' }
  if (record.revision !== expectedRevision) return { status: 'conflict' }
  const revision = expectedRevision + 1
  await requestResult(
    transaction.objectStore(PLANS_STORE).put({ ...record, revision, updated_at: updatedAt }),
  )
  await requestResult(transaction.objectStore(PLAN_DOCUMENTS_STORE).put({ id, document }))
  return { status: 'written', revision }
}

/**
 * Replaces a plan's document under optimistic concurrency.
 *
 * @param id Plan to write.
 * @param document Document to store, already stamped to the current schema version.
 * @param expectedRevision Revision the caller believes is current.
 * @param updatedAt ISO timestamp to record as the modification time.
 */
export async function writePlanDocument(
  id: string,
  document: PlanDocument,
  expectedRevision: number,
  updatedAt: string,
): Promise<DocumentWriteResult> {
  const db = await openDb()
  return runTransaction(db, [PLANS_STORE, PLAN_DOCUMENTS_STORE], 'readwrite', (transaction) =>
    commitDocument(transaction, id, document, expectedRevision, updatedAt),
  )
}

/**
 * Keeps a pre-repair copy of a document and stores the repaired one, in a
 * single transaction: the backup is worthless if the write that made it
 * necessary lands without it.
 *
 * The backup is added, never put — one copy per plan and source version, the
 * oldest kept, mirroring `save_document_backup`'s `INSERT OR IGNORE`.
 */
export async function backUpAndWriteDocument(
  backup: DocumentBackupRecord,
  document: PlanDocument,
  expectedRevision: number,
  updatedAt: string,
): Promise<DocumentWriteResult> {
  const db = await openDb()
  return runTransaction(
    db,
    [PLANS_STORE, PLAN_DOCUMENTS_STORE, DOCUMENT_BACKUPS_STORE],
    'readwrite',
    async (transaction) => {
      await addIfAbsent(transaction.objectStore(DOCUMENT_BACKUPS_STORE), backup)
      return commitDocument(transaction, backup.plan_id, document, expectedRevision, updatedAt)
    },
  )
}

/**
 * Applies a metadata patch, leaving omitted fields as they are (the `COALESCE`
 * of the backend's `UPDATE`) and bumping `updated_at` but never the revision —
 * a rename is not a document edit and must not invalidate an open editor.
 *
 * @returns Whether a plan with this id existed.
 */
export async function patchPlanRecord(
  id: string,
  patch: PlanMetadataPatch,
  updatedAt: string,
): Promise<boolean> {
  const db = await openDb()
  return runTransaction(db, PLANS_STORE, 'readwrite', async (transaction) => {
    const store = transaction.objectStore(PLANS_STORE)
    const record = await requestResult<PlanRecord | undefined>(store.get(id))
    if (record === undefined) return false
    await requestResult(
      store.put({
        ...record,
        name: patch.name ?? record.name,
        description: patch.description ?? record.description,
        updated_at: updatedAt,
      }),
    )
    return true
  })
}

/**
 * Sets or clears a plan's archival timestamp.
 *
 * @param archivedAt ISO timestamp to archive at, or `null` to restore.
 * @returns Whether a plan with this id existed.
 */
export async function setPlanArchivedAt(
  id: string,
  archivedAt: string | null,
  updatedAt: string,
): Promise<boolean> {
  const db = await openDb()
  return runTransaction(db, PLANS_STORE, 'readwrite', async (transaction) => {
    const store = transaction.objectStore(PLANS_STORE)
    const record = await requestResult<PlanRecord | undefined>(store.get(id))
    if (record === undefined) return false
    await requestResult(store.put({ ...record, archived_at: archivedAt, updated_at: updatedAt }))
    return true
  })
}

/**
 * Removes a plan's metadata and document rows.
 *
 * Its rows in `documentBackups` are deliberately left behind, matching the
 * backend, where deleting a plan does not cascade into `document_backups`: a
 * backup is the last copy of a document as it was before this build touched it.
 */
export async function deletePlanRows(id: string): Promise<void> {
  const db = await openDb()
  await runTransaction(
    db,
    [PLANS_STORE, PLAN_DOCUMENTS_STORE],
    'readwrite',
    async (transaction) => {
      await requestResult(transaction.objectStore(PLANS_STORE).delete(id))
      await requestResult(transaction.objectStore(PLAN_DOCUMENTS_STORE).delete(id))
    },
  )
}
