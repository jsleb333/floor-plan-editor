import { ASSETS_STORE, openDb } from '@/persistence/browser/db'
import { requestResult, runTransaction } from '@/persistence/browser/idb'

/**
 * Raw storage operations over the asset store, the browser counterpart of
 * `FileAssetRepository`. Assets are immutable: written once, read many, never
 * updated in place.
 */

/**
 * A row of the `assets` store. The image is kept as a `Blob` rather than as
 * bytes on purpose — the browser can hold a blob outside the JS heap and hand
 * it to `<img>` through an object URL without ever materialising it, which is
 * what makes a 30 MiB underlay photo affordable.
 */
export interface AssetRecord {
  id: string
  content_type: string
  size_bytes: number
  created_at: string
  blob: Blob
}

/**
 * Stores a new asset.
 *
 * @throws {ApiError} 507 when the image does not fit in the origin's storage
 *   quota — the failure mode the size limit exists to make rare.
 */
export async function insertAsset(record: AssetRecord): Promise<void> {
  const db = await openDb()
  await runTransaction(db, ASSETS_STORE, 'readwrite', (transaction) =>
    requestResult(transaction.objectStore(ASSETS_STORE).add(record)),
  )
}

/** An asset with its image, or `null` when no asset has this id. */
export async function readAsset(id: string): Promise<AssetRecord | null> {
  const db = await openDb()
  return runTransaction(db, ASSETS_STORE, 'readonly', async (transaction) => {
    const record = await requestResult<AssetRecord | undefined>(
      transaction.objectStore(ASSETS_STORE).get(id),
    )
    return record ?? null
  })
}

/**
 * Whether an asset exists, counted rather than fetched so that validating a
 * plan's `underlay_asset_id` does not pull a multi-megabyte image into memory.
 */
export async function assetExists(id: string): Promise<boolean> {
  const db = await openDb()
  const count = await runTransaction(db, ASSETS_STORE, 'readonly', (transaction) =>
    requestResult(transaction.objectStore(ASSETS_STORE).count(id)),
  )
  return count > 0
}
