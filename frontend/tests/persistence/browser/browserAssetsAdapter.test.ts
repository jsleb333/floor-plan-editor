import 'fake-indexeddb/auto'

import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import { assetExists, insertAsset } from '@/persistence/browser/assetRecords'
import { browserAssetsPort } from '@/persistence/browser/browserAssetsAdapter'
import { resetBrowserDb } from '../../helpers/browserDb'

const { readAssetBlob, resolveAssetUrl, uploadAsset } = browserAssetsPort

/** The backend's `max_asset_size_bytes` default, which the adapter mirrors. */
const MAX_ASSET_SIZE_BYTES = 30 * 1024 * 1024

/** A 32-character hex id with no dashes, as the backend's `uuid4().hex` produces. */
const HEX_ID_PATTERN = /^[0-9a-f]{32}$/

/** Old enough that the collector's settling window does not protect it. */
const LONG_AGO = '2020-01-01T00:00:00.000Z'

const originalAdd = IDBObjectStore.prototype.add

async function status(promise: Promise<unknown>): Promise<number | undefined> {
  const error: unknown = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  return error instanceof ApiError ? error.status : undefined
}

async function message(promise: Promise<unknown>): Promise<string> {
  const error: unknown = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  return error instanceof Error ? error.message : ''
}

/** An asset from a previous session that no plan document references. */
async function seedOrphan(id: string): Promise<void> {
  await insertAsset({
    id,
    content_type: 'image/png',
    size_bytes: 3,
    created_at: LONG_AGO,
    blob: new Blob(['png'], { type: 'image/png' }),
  })
}

/** Makes the next `count` writes to any object store report an exhausted quota. */
function failAddsWithQuota(count: number): void {
  let remaining = count
  IDBObjectStore.prototype.add = function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ): IDBRequest<IDBValidKey> {
    if (remaining > 0) {
      remaining -= 1
      throw new DOMException('the quota has been exceeded', 'QuotaExceededError')
    }
    return originalAdd.call(this, value, key)
  }
}

afterEach(() => {
  IDBObjectStore.prototype.add = originalAdd
})

beforeEach(async () => {
  // jsdom's Blob does not survive the structured clone IndexedDB stores values
  // with, and jsdom has no `URL.createObjectURL` at all. Node's Blob/File do
  // clone, so the adapter is exercised against real blob semantics rather than
  // a stub of its own storage.
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('File', NodeFile)
  URL.createObjectURL = vi.fn((blob: Blob) => `blob:test/${String(blob.size)}`)
  URL.revokeObjectURL = vi.fn()
  await resetBrowserDb()
})

describe('uploadAsset', () => {
  it('stores the image and returns its metadata under a fresh dashless hex id', async () => {
    const file = new File(['png-bytes'], 'plan.png', { type: 'image/png' })

    const asset = await uploadAsset(file)

    expect(asset.id).toMatch(HEX_ID_PATTERN)
    expect(asset.content_type).toBe('image/png')
    expect(asset.size_bytes).toBe(file.size)
    expect(Date.parse(asset.created_at)).not.toBeNaN()
    await expect(readAssetBlob(asset.id).then((blob) => blob.text())).resolves.toBe('png-bytes')
  })

  it('gives every upload its own id', async () => {
    const first = await uploadAsset(new File(['a'], 'a.jpg', { type: 'image/jpeg' }))
    const second = await uploadAsset(new File(['b'], 'b.jpg', { type: 'image/jpeg' }))

    expect(first.id).not.toBe(second.id)
    await expect(readAssetBlob(second.id).then((blob) => blob.text())).resolves.toBe('b')
  })

  it('refuses a content type outside the image whitelist with a 415', async () => {
    const file = new File(['gif-bytes'], 'notes.gif', { type: 'image/gif' })

    expect(await status(uploadAsset(file))).toBe(415)
  })

  it('refuses an image over the size limit with a 413', async () => {
    const file = new File([new Uint8Array(MAX_ASSET_SIZE_BYTES + 1)], 'big.png', {
      type: 'image/png',
    })

    expect(await status(uploadAsset(file))).toBe(413)
  })

  it('accepts an image right at the size limit', async () => {
    const file = new File([new Uint8Array(MAX_ASSET_SIZE_BYTES)], 'exact.png', {
      type: 'image/png',
    })

    await expect(uploadAsset(file)).resolves.toMatchObject({ size_bytes: MAX_ASSET_SIZE_BYTES })
  })

  it('reclaims what earlier plans left behind and succeeds on the retry', async () => {
    await seedOrphan('stale')
    failAddsWithQuota(1)

    const asset = await uploadAsset(new File(['png-bytes'], 'plan.png', { type: 'image/png' }))

    await expect(assetExists('stale')).resolves.toBe(false)
    await expect(readAssetBlob(asset.id).then((blob) => blob.text())).resolves.toBe('png-bytes')
  })

  it('gives up with a 507 naming the image when the sweep frees nothing', async () => {
    failAddsWithQuota(2)

    const failed = uploadAsset(new File(['png-bytes'], 'plan.png', { type: 'image/png' }))
    const reported = await failed.then(
      () => null,
      (error: unknown) => error,
    )

    expect(reported).toBeInstanceOf(ApiError)
    expect((reported as ApiError).status).toBe(507)
    expect((reported as ApiError).message).toContain(
      'Not enough browser storage left for this image',
    )
    expect((reported as ApiError).message).toContain('delete archived plans')
  })

  it('retries only once, so a quota that outlives the sweep is not hammered', async () => {
    await seedOrphan('stale')
    failAddsWithQuota(2)

    expect(await status(uploadAsset(new File(['a'], 'a.png', { type: 'image/png' })))).toBe(507)
    await expect(assetExists('stale')).resolves.toBe(false)
  })

  it('reports a non-quota storage failure as a 500 without sweeping anything', async () => {
    await seedOrphan('stale')
    IDBObjectStore.prototype.add = function (): IDBRequest<IDBValidKey> {
      throw new DOMException('boom', 'UnknownError')
    }

    expect(await status(uploadAsset(new File(['a'], 'a.png', { type: 'image/png' })))).toBe(500)
    IDBObjectStore.prototype.add = originalAdd
    await expect(assetExists('stale')).resolves.toBe(true)
  })
})

describe('quota messages', () => {
  it('tells the user what to do rather than restating the browser’s error', async () => {
    failAddsWithQuota(2)

    const reported = await message(
      uploadAsset(new File(['png-bytes'], 'plan.png', { type: 'image/png' })),
    )

    expect(reported).not.toContain('the quota has been exceeded')
    expect(reported).toContain('Export a plan to a file')
  })
})

describe('resolveAssetUrl', () => {
  it('lends an object URL bound to the stored image', async () => {
    const asset = await uploadAsset(new File(['png-bytes'], 'plan.png', { type: 'image/png' }))

    const handle = await resolveAssetUrl(asset.id)

    expect(handle.url).toBe('blob:test/9')
    expect(vi.mocked(URL.createObjectURL).mock.calls[0]?.[0]).toBeInstanceOf(Blob)
  })

  it('revokes exactly once however many times it is released', async () => {
    const asset = await uploadAsset(new File(['png-bytes'], 'plan.png', { type: 'image/png' }))
    const handle = await resolveAssetUrl(asset.id)

    handle.release()
    handle.release()

    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledWith(handle.url)
  })

  it('rejects an unknown id with a 404 rather than a dangling URL', async () => {
    expect(await status(resolveAssetUrl('missing'))).toBe(404)
    expect(vi.mocked(URL.createObjectURL)).not.toHaveBeenCalled()
  })
})

describe('readAssetBlob', () => {
  it('rejects an unknown id with a 404', async () => {
    expect(await status(readAssetBlob('missing'))).toBe(404)
  })
})
