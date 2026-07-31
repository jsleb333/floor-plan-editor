import { ApiError, request } from '@/api/client'
import type { AssetsPort, AssetUrlHandle } from '@/persistence/ports'
import type { Asset } from '@/types/asset'

/** Uploads an underlay image (JPEG/PNG) as a multipart form under the `file` field. */
export async function uploadAsset(file: File): Promise<Asset> {
  const form = new FormData()
  form.append('file', file)
  return request<Asset>('/assets', { method: 'POST', body: form })
}

/** URL serving the asset's image bytes (immutable, cacheable) — usable as an `<image href>`. */
export function assetUrl(id: string): string {
  return `/api/assets/${id}`
}

async function resolveAssetUrl(id: string): Promise<AssetUrlHandle> {
  return { url: assetUrl(id), release: () => {} }
}

async function readAssetBlob(id: string): Promise<Blob> {
  const response = await fetch(assetUrl(id))
  if (!response.ok) throw new ApiError(response.status, `Failed to load asset ${id}`)
  return response.blob()
}

export const restAssetsPort: AssetsPort = { uploadAsset, resolveAssetUrl, readAssetBlob }
