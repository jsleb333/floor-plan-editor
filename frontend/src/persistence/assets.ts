import type { AssetsPort, AssetUrlHandle } from '@/persistence/ports'
import { restAssetsPort } from '@/persistence/rest/restAssetsAdapter'
import type { Asset } from '@/types/asset'

/** Chosen at BUILD time; anything other than 'browser' means the REST backend. */
// The browser (IndexedDB) adapter lands in a later phase; both branches are
// `restAssetsPort` for now, but the ternary reads `import.meta.env.VITE_PERSISTENCE`
// literally at this site so Vite's `define` substitution + esbuild folding +
// Rollup DCE can drop the unused adapter from the static build once it exists —
// cross-module constant propagation is not guaranteed to do the same.
const port: AssetsPort =
  import.meta.env.VITE_PERSISTENCE === 'browser' ? restAssetsPort : restAssetsPort

/** Uploads an underlay image (JPEG/PNG) as a multipart form under the `file` field. */
export function uploadAsset(file: File): Promise<Asset> {
  return port.uploadAsset(file)
}

export function resolveAssetUrl(id: string): Promise<AssetUrlHandle> {
  return port.resolveAssetUrl(id)
}

export function readAssetBlob(id: string): Promise<Blob> {
  return port.readAssetBlob(id)
}
