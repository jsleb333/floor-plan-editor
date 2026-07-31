import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import { assetUrl, uploadAsset } from '@/api/assets'

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
