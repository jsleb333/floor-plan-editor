import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import { assetUrl, restAssetsPort, uploadAsset } from '@/persistence/rest/restAssetsAdapter'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('assetUrl', () => {
  it('builds the serving URL for an asset id', () => {
    expect(assetUrl('abc-123')).toBe('/api/assets/abc-123')
  })
})

describe('uploadAsset', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs the image as multipart under the `file` field and returns the asset', async () => {
    const asset = { id: 'a1', content_type: 'image/png', size_bytes: 42, created_at: 'now' }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(asset))
    const file = new File(['bytes'], 'plan.png', { type: 'image/png' })

    const result = await uploadAsset(file)

    expect(result).toEqual(asset)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/assets')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeInstanceOf(FormData)
    expect((init?.body as FormData).get('file')).toBe(file)
    // The browser sets the multipart boundary — the client must not force a header.
    expect(init?.headers).toBeUndefined()
  })

  it('surfaces a 413 too-large error as an ApiError with the backend detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'Image exceeds the 10 MB limit.' }, 413),
    )
    const file = new File(['x'], 'big.png', { type: 'image/png' })

    const error = await uploadAsset(file).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(413)
    expect((error as ApiError).message).toBe('Image exceeds the 10 MB limit.')
  })

  it('surfaces a 415 unsupported-type error with the backend detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'Only JPEG and PNG images are supported.' }, 415),
    )
    const file = new File(['x'], 'notes.gif', { type: 'image/gif' })

    await expect(uploadAsset(file)).rejects.toMatchObject({
      status: 415,
      message: 'Only JPEG and PNG images are supported.',
    })
  })
})

describe('readAssetBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches the asset URL and returns its bytes as a blob', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('image-bytes', {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
    )

    const result = await restAssetsPort.readAssetBlob('abc-123')

    expect(fetchMock).toHaveBeenCalledWith('/api/assets/abc-123')
    expect(result.type).toBe('image/png')
    expect(await result.text()).toBe('image-bytes')
  })

  it('throws an ApiError when the fetch response is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }))

    const error = await restAssetsPort.readAssetBlob('missing').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(404)
    expect((error as ApiError).message).toBe('Failed to load asset missing')
  })
})
