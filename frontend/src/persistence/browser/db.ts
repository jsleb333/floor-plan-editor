import { ApiError } from '@/api/client'
import { mapIdbError } from '@/persistence/browser/idb'

/**
 * The IndexedDB database backing the static build, and the single place its
 * schema is declared.
 *
 * WHY FOUR STORES, AND WHY METADATA AND DOCUMENT ARE SPLIT. `listPlans` runs on
 * every home-page mount, and a store holding metadata and document together
 * would force every plan's full geometry — walls, devices, wires — into the JS
 * heap just to render a list of names. Atomicity is not lost by splitting them:
 * one `readwrite` transaction spans both stores, so a revision bump and its
 * document write commit together or not at all, which is exactly what the
 * backend's single `UPDATE ... WHERE revision = ?` guarantees.
 *
 * WHY `documentBackups` EXISTS IN v1 WITH NOTHING WRITING IT YET. Object stores
 * can only be created inside `onupgradeneeded`, so declaring it now costs three
 * lines and saves a version bump later; and a schema change to a store holding
 * the only copy of a repaired document is exactly the kind of migration the
 * project rules say to plan for rather than improvise.
 *
 * WHY THE CONNECTION IS OPENED LAZILY. The REST build must not ship any of
 * this. Rollup only drops the `browser/` subtree if none of its modules has an
 * import-time side effect, and opening a database at module scope is the
 * loudest side effect there is — so the connection promise is created inside
 * {@link openDb}, on the first call, and never at module scope.
 */

/** Name of the database; one per origin, shared by every tab of the app. */
export const DB_NAME = 'floor-plan-editor'

/** Schema version. Bumping it runs the `oldVersion` steps below that are newer. */
export const DB_VERSION = 1

/** Plan metadata, one row per plan, without the document. */
export const PLANS_STORE = 'plans'

/** Plan documents, keyed by plan id: `{ id, document }`. */
export const PLAN_DOCUMENTS_STORE = 'planDocuments'

/** Underlay images: metadata plus the image `Blob` itself. */
export const ASSETS_STORE = 'assets'

/** Pre-repair copies of documents, keyed by `[plan_id, from_version]`. */
export const DOCUMENT_BACKUPS_STORE = 'documentBackups'

/** Index on `plans.updated_at`, walked backwards to list plans newest-first. */
export const UPDATED_AT_INDEX = 'by_updated_at'

const CONFLICT_STATUS = 409

const BLOCKED_MESSAGE =
  'Another tab of this app is holding an older version of the local plan database open. ' +
  'Close the other tabs and reload to continue.'

let connection: Promise<IDBDatabase> | null = null

/**
 * Creates the stores this version introduces. Written as stepwise
 * `oldVersion <` blocks rather than a rebuild so a future v2 is purely
 * additive: a database at v1 runs only the v2 block, and a fresh one runs both.
 *
 * @param db The upgrading connection.
 * @param oldVersion Version the database was at, `0` when it did not exist.
 */
function upgrade(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    const plans = db.createObjectStore(PLANS_STORE, { keyPath: 'id' })
    plans.createIndex(UPDATED_AT_INDEX, 'updated_at')
    db.createObjectStore(PLAN_DOCUMENTS_STORE, { keyPath: 'id' })
    db.createObjectStore(ASSETS_STORE, { keyPath: 'id' })
    db.createObjectStore(DOCUMENT_BACKUPS_STORE, { keyPath: ['plan_id', 'from_version'] })
  }
}

function connect(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => {
      upgrade(request.result, event.oldVersion)
    }
    request.onblocked = () => {
      reject(new ApiError(CONFLICT_STATUS, BLOCKED_MESSAGE))
    }
    request.onerror = () => {
      reject(mapIdbError(request.error))
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        connection = null
      }
      resolve(db)
    }
  })
}

/**
 * The shared connection, opened on first use and cached afterwards. A failed
 * open is not cached, so a transient failure (a blocking tab that then closes)
 * is retried by the next caller rather than poisoning the session.
 */
export function openDb(): Promise<IDBDatabase> {
  if (connection === null) {
    connection = connect().catch((error: unknown) => {
      connection = null
      throw error
    })
  }
  return connection
}

/**
 * Closes the cached connection and forgets it, so the next {@link openDb}
 * reopens. Another tab upgrading the schema triggers this through
 * `versionchange` — a connection left open there would block that tab forever.
 */
export async function closeDb(): Promise<void> {
  const pending = connection
  connection = null
  if (pending === null) return
  const db = await pending.catch(() => null)
  db?.close()
}
