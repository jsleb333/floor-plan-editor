import { request } from '@/api/client'
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
