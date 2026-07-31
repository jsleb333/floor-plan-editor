import { ASSETS_STORE, PLAN_DOCUMENTS_STORE, openDb } from '@/persistence/browser/db'
import {
  collectCursor,
  mapIdbError,
  requestResult,
  runTransaction,
} from '@/persistence/browser/idb'
import type { AssetRecord } from '@/persistence/browser/assetRecords'
import type { PlanDocumentRecord } from '@/persistence/browser/planRecords'

/**
 * Reclaims the storage held by underlay images no plan points at any more.
 *
 * WHY THIS EXISTS HERE AND NOT SERVER-SIDE. The backend never deletes an asset,
 * because disk is cheap and a stray 30 MiB file costs nothing. A browser quota
 * is not cheap and is shared by every plan, and two ordinary flows orphan an
 * image the instant they run: permanently deleting a plan, and importing a new
 * underlay over an existing one (`setUnderlay` simply overwrites `image_ref`).
 * Recalibrating by re-importing three photos would otherwise burn ~90 MiB that
 * nothing in the app can ever give back.
 *
 * WHY IT IS WRITTEN THE WAY IT IS. Deleting an asset that is still referenced
 * destroys the photo a user traced their plan from, and no undo, reload or
 * export brings it back. So this module is biased all the way to one side:
 * every uncertainty — a failed read, a document it cannot understand, an image
 * young enough that the document naming it may not have been written yet —
 * resolves to "keep it". The cost of being wrong in that direction is some
 * wasted quota that the next sweep reclaims. The cost of being wrong in the
 * other direction is permanent.
 *
 * In particular the reference set is read by hand rather than through
 * `readPlanDocument`: that funnel REPAIRS what it cannot parse, and
 * `underlaySchema.nullable().catch(null)` turns a malformed underlay into no
 * underlay at all — which here would silently drop a reference and then delete
 * the image it named.
 */

/**
 * How long an asset is protected from collection after it was stored.
 *
 * An upload and the document write that references it are NOT one atomic step.
 * `useUnderlayImport` uploads the image, mutates the document in memory, and
 * only persists it on the next autosave tick two seconds later; a second tab
 * cannot observe that in-flight state at all. An image younger than this window
 * is therefore assumed to be on its way into a document rather than orphaned.
 * Thirty times the autosave debounce: it costs a late sweep and buys the
 * guarantee that a sweep can never race an import.
 */
const SETTLING_WINDOW_MS = 60_000

/** An asset as the sweep needs to see it: its id and its age, never its bytes. */
interface AssetSummary {
  id: string
  /** `created_at` in epoch milliseconds, or `NaN` when it could not be read. */
  createdAt: number
}

/**
 * The outcome of reading one stored document's underlay reference. `unreadable`
 * is not "this document has no underlay" — it is "this document might reference
 * anything", and it stops the sweep.
 */
type DocumentReference = { status: 'read'; imageRef: string | null } | { status: 'unreadable' }

/** A consistent snapshot of what is referenced and what is stored, or nothing at all. */
type ReferenceScan =
  | { status: 'complete'; referenced: ReadonlySet<string>; assets: readonly AssetSummary[] }
  | { status: 'aborted' }

/**
 * The asset id a stored document references, read structurally from whatever
 * the database happens to hold.
 *
 * Anything that is not recognisably "no underlay" or "an underlay with a string
 * `image_ref`" is reported unreadable, including an array, a primitive and an
 * underlay whose `image_ref` is missing or of the wrong type. A document from a
 * future build could carry a shape this function has never seen, and guessing
 * that it holds no reference is the one guess that deletes data.
 */
function readImageRef(document: unknown): DocumentReference {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return { status: 'unreadable' }
  }
  if (!('underlay' in document)) return { status: 'read', imageRef: null }
  const underlay: unknown = document.underlay
  if (underlay === null || underlay === undefined) return { status: 'read', imageRef: null }
  if (typeof underlay !== 'object' || Array.isArray(underlay)) return { status: 'unreadable' }
  if (!('image_ref' in underlay)) return { status: 'unreadable' }
  const imageRef: unknown = underlay.image_ref
  if (typeof imageRef !== 'string') return { status: 'unreadable' }
  return { status: 'read', imageRef }
}

/**
 * Walks the asset store, projecting each row to its id and age as the cursor
 * yields it.
 *
 * Deliberately not `collectCursor`: that would build an array of whole asset
 * rows, and an asset row carries a multi-megabyte image. The sweep runs when
 * storage is already exhausted, which is the worst possible moment to hold
 * every stored photo at once.
 */
function collectAssetSummaries(
  request: IDBRequest<IDBCursorWithValue | null>,
): Promise<AssetSummary[]> {
  return new Promise((resolve, reject) => {
    const summaries: AssetSummary[] = []
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor === null) {
        resolve(summaries)
        return
      }
      // The id comes from the primary key rather than the row body: the key is
      // what a delete would target, and it exists even if the row is malformed.
      const id = cursor.primaryKey
      if (typeof id === 'string') {
        const record = cursor.value as Partial<AssetRecord>
        summaries.push({ id, createdAt: Date.parse(record.created_at ?? '') })
      }
      cursor.continue()
    }
    request.onerror = () => {
      reject(mapIdbError(request.error))
    }
  })
}

/**
 * Reads every document's reference and every stored asset in ONE readonly
 * transaction, so the two cannot come from different moments — a plan created
 * between two separate reads would look like an unreferenced image.
 *
 * The synchronous loop between the two cursor walks is safe under the
 * auto-commit hazard documented in `./idb`: it awaits nothing, so the second
 * cursor is opened before the transaction can commit.
 */
async function scanReferences(): Promise<ReferenceScan> {
  try {
    const db = await openDb()
    return await runTransaction(
      db,
      [PLAN_DOCUMENTS_STORE, ASSETS_STORE],
      'readonly',
      async (transaction) => {
        const rows = await collectCursor<PlanDocumentRecord>(
          transaction.objectStore(PLAN_DOCUMENTS_STORE).openCursor(),
        )
        const referenced = new Set<string>()
        for (const row of rows) {
          const read = readImageRef(row.document)
          if (read.status === 'unreadable') return { status: 'aborted' as const }
          if (read.imageRef !== null) referenced.add(read.imageRef)
        }
        const assets = await collectAssetSummaries(
          transaction.objectStore(ASSETS_STORE).openCursor(),
        )
        return { status: 'complete' as const, referenced, assets }
      },
    )
  } catch {
    // A scan that failed anywhere is a scan that saw part of the truth, and a
    // partial reference set names orphans that are not orphans.
    return { status: 'aborted' }
  }
}

/** Removes the given assets in one transaction: all of them, or none of them. */
async function deleteAssets(ids: readonly string[]): Promise<void> {
  const db = await openDb()
  await runTransaction(db, ASSETS_STORE, 'readwrite', async (transaction) => {
    const store = transaction.objectStore(ASSETS_STORE)
    for (const id of ids) {
      await requestResult(store.delete(id))
    }
  })
}

/**
 * Deletes stored assets no document references. Returns the ids removed.
 *
 * Every plan's document is scanned, archived ones included — archiving is a
 * soft delete, and its underlay is still the user's. Two plans sharing one
 * image id (which is exactly what `duplicatePlan` produces) need no special
 * case: a reference set does not care how many documents put an id in it.
 *
 * This never rejects. It is maintenance running behind a user action that has
 * already succeeded, and it must not be the reason that action reports failure;
 * an empty result is the honest report that nothing was reclaimed. That is not
 * the `@/stores/deviceMru` swallow — the caller is told, in the return value,
 * exactly what happened.
 */
export async function collectOrphanAssets(): Promise<string[]> {
  const scan = await scanReferences()
  if (scan.status === 'aborted') return []
  const now = Date.now()
  const orphans = scan.assets
    // An unparseable `created_at` reads as NaN, and every comparison against
    // NaN is false, so an asset whose age is unknown is kept.
    .filter(
      (asset) => !scan.referenced.has(asset.id) && now - asset.createdAt >= SETTLING_WINDOW_MS,
    )
    .map((asset) => asset.id)
  if (orphans.length === 0) return []
  try {
    await deleteAssets(orphans)
  } catch {
    // The transaction rolled back, so nothing was removed and nothing is owed
    // to the caller beyond saying so.
    return []
  }
  return orphans
}
