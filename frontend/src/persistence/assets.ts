import { browserAssetsPort } from '@/persistence/browser/browserAssetsAdapter'
import type { AssetsPort, AssetUrlHandle } from '@/persistence/ports'
import { restAssetsPort } from '@/persistence/rest/restAssetsAdapter'
import type { Asset } from '@/types/asset'

/** Chosen at BUILD time; anything other than 'browser' means the REST backend. */
// The ternary reads `import.meta.env.VITE_PERSISTENCE` literally at this site so
// Vite's `define` substitution + esbuild folding + Rollup DCE drop the unused
// adapter — cross-module constant propagation is not guaranteed to do the same.
// Keep it inline: hoisting the comparison into a named constant is what breaks
// the REST build's ability to shed the whole IndexedDB subtree.
const port: AssetsPort =
  import.meta.env.VITE_PERSISTENCE === 'browser' ? browserAssetsPort : restAssetsPort

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
