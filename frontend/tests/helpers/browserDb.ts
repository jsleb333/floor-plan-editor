import {
  DB_NAME,
  DOCUMENT_BACKUPS_STORE,
  PLAN_DOCUMENTS_STORE,
  closeDb,
  openDb,
} from '@/persistence/browser/db'
import { collectCursor, requestResult, runTransaction } from '@/persistence/browser/idb'
import type { DocumentBackupRecord } from '@/persistence/browser/planRecords'

/**
 * Helpers for the IndexedDB adapter tests. The database is module-global state
 * within a test file, so every file using it resets between tests.
 *
 * The reads here go through the same `openDb`/`runTransaction` the adapters use
 * rather than re-implementing raw IndexedDB plumbing, so a test asserting on
 * stored rows cannot pass against a database the adapters could not read.
 */

/** Closes the cached connection and drops the database, leaving the next open to recreate it. */
export async function resetBrowserDb(): Promise<void> {
  await closeDb()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => {
      resolve()
    }
    request.onerror = () => {
      reject(request.error)
    }
    request.onblocked = () => {
      reject(new Error('deleteDatabase is blocked: a connection is still open.'))
    }
  })
}

/** Every pre-repair copy stored for a plan. */
export async function readDocumentBackups(planId: string): Promise<DocumentBackupRecord[]> {
  const db = await openDb()
  const rows = await runTransaction(db, DOCUMENT_BACKUPS_STORE, 'readonly', (transaction) =>
    collectCursor<DocumentBackupRecord>(
      transaction.objectStore(DOCUMENT_BACKUPS_STORE).openCursor(),
    ),
  )
  return rows.filter((row) => row.plan_id === planId)
}

/**
 * Overwrites a plan's stored document with arbitrary JSON, standing in for a
 * document written by an older build of the app.
 */
export async function putRawDocument(planId: string, document: unknown): Promise<void> {
  const db = await openDb()
  await runTransaction(db, PLAN_DOCUMENTS_STORE, 'readwrite', (transaction) =>
    requestResult(transaction.objectStore(PLAN_DOCUMENTS_STORE).put({ id: planId, document })),
  )
}

/** A plan's stored document exactly as it sits in the database, unrepaired. */
export async function readRawDocument(planId: string): Promise<unknown> {
  const db = await openDb()
  const row = await runTransaction(db, PLAN_DOCUMENTS_STORE, 'readonly', (transaction) =>
    requestResult<{ id: string; document: unknown } | undefined>(
      transaction.objectStore(PLAN_DOCUMENTS_STORE).get(planId),
    ),
  )
  return row?.document
}
