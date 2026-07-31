import { ApiError } from '@/api/client'
import { collectOrphanAssets } from '@/persistence/browser/assetGarbageCollector'
import { insertAsset, readAsset } from '@/persistence/browser/assetRecords'
import type { AssetRecord } from '@/persistence/browser/assetRecords'
import { requestPersistentStorage } from '@/persistence/browser/storagePersistence'
import type { AssetsPort, AssetUrlHandle } from '@/persistence/ports'
import type { Asset } from '@/types/asset'

/**
 * {@link AssetsPort} backed by the browser's IndexedDB, for the static build
 * that ships without a server.
 *
 * It enforces the same two upload rules as `AssetService` — the image type
 * whitelist and the size limit — with the same statuses, so the creation card's
 * error handling reads identically in both builds. What differs is what a URL
 * for an asset IS: the REST build serves a permanent path, while here the bytes
 * only exist locally and have to be lent to the document through a revocable
 * object URL.
 */

const NOT_FOUND_STATUS = 404
const PAYLOAD_TOO_LARGE_STATUS = 413
const UNSUPPORTED_MEDIA_TYPE_STATUS = 415
const INSUFFICIENT_STORAGE_STATUS = 507

/** The image types an underlay may be, mirroring `ASSET_EXTENSIONS_BY_CONTENT_TYPE`. */
const SUPPORTED_CONTENT_TYPES: readonly string[] = ['image/jpeg', 'image/png']

/** Upload ceiling in bytes, mirroring the backend's `max_asset_size_bytes` default. */
const MAX_ASSET_SIZE_BYTES = 30 * 1024 * 1024

/**
 * Stores an image, and on a full quota reclaims what previous plans left behind
 * and tries once more.
 *
 * A quota failure is the only failure worth a second attempt here, and only
 * because the app itself is usually the reason for it: an underlay replaced by
 * a re-import, or a plan deleted while its photo stayed. Retrying a sweep that
 * freed nothing would just fail identically, so the original 507 — the one
 * carrying advice the user can act on — is raised instead.
 */
async function storeWithQuotaRecovery(record: AssetRecord): Promise<void> {
  try {
    await insertAsset(record)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== INSUFFICIENT_STORAGE_STATUS) throw error
    const reclaimed = await collectOrphanAssets()
    if (reclaimed.length === 0) throw error
    await insertAsset(record)
  }
}

/**
 * Stores an underlay image under a fresh id.
 *
 * The id is a 32-character hex string with no dashes, matching the backend's
 * `uuid4().hex`, because it ends up in documents as `underlay.image_ref` and a
 * plan exported from one build is opened in the other.
 *
 * @throws {ApiError} 415 when the file is not a JPEG or a PNG; 413 when it is
 *   over the size limit, which is worth keeping even with no server to protect
 *   because it is what stops one photo from consuming the origin quota every
 *   plan shares; 507 when the image does not fit in that quota even after the
 *   orphan sweep.
 */
async function uploadAsset(file: File): Promise<Asset> {
  if (!SUPPORTED_CONTENT_TYPES.includes(file.type)) {
    throw new ApiError(
      UNSUPPORTED_MEDIA_TYPE_STATUS,
      `Asset content type '${file.type}' is not supported; ` +
        `accepted types: ${SUPPORTED_CONTENT_TYPES.join(', ')}.`,
    )
  }
  if (file.size > MAX_ASSET_SIZE_BYTES) {
    throw new ApiError(
      PAYLOAD_TOO_LARGE_STATUS,
      `Asset of ${file.size} bytes exceeds the maximum allowed ` +
        `size of ${MAX_ASSET_SIZE_BYTES} bytes.`,
    )
  }
  const asset: Asset = {
    id: crypto.randomUUID().replaceAll('-', ''),
    content_type: file.type,
    size_bytes: file.size,
    created_at: new Date().toISOString(),
  }
  await storeWithQuotaRecovery({ ...asset, blob: file })
  // The bytes that just landed are the most expensive thing in this origin's
  // storage and the one thing the user cannot redraw. Fire-and-forget, so a
  // permission prompt never delays the import that triggered it.
  void requestPersistentStorage()
  return asset
}

/**
 * Lends the caller a URL for an asset's bytes, valid until it is released.
 *
 * Unlike the REST build's permanent path, an object URL pins the blob in memory
 * for as long as the document holds it, so releasing is not optional. `release`
 * is idempotent: a double release is a plausible caller bug (an unmount racing
 * a watcher), and swallowing the second call keeps the invariant "the URL is
 * revoked exactly once" true rather than merely intended.
 *
 * @throws {ApiError} 404 when no asset has this id.
 */
async function resolveAssetUrl(id: string): Promise<AssetUrlHandle> {
  const record = await readAsset(id)
  if (record === null) throw new ApiError(NOT_FOUND_STATUS, `Asset '${id}' not found.`)
  const url = URL.createObjectURL(record.blob)
  let released = false
  return {
    url,
    release: () => {
      if (released) return
      released = true
      URL.revokeObjectURL(url)
    },
  }
}

/**
 * The asset's image bytes.
 *
 * @throws {ApiError} 404 when no asset has this id.
 */
async function readAssetBlob(id: string): Promise<Blob> {
  const record = await readAsset(id)
  if (record === null) throw new ApiError(NOT_FOUND_STATUS, `Asset '${id}' not found.`)
  return record.blob
}

export const browserAssetsPort: AssetsPort = { uploadAsset, resolveAssetUrl, readAssetBlob }
