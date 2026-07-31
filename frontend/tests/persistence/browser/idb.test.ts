import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import { ApiError } from '@/api/client'
import { DOCUMENT_BACKUPS_STORE, openDb } from '@/persistence/browser/db'
import {
  addIfAbsent,
  mapIdbError,
  requestResult,
  runTransaction,
  withQuotaMessage,
} from '@/persistence/browser/idb'
import { resetBrowserDb } from '../../helpers/browserDb'

describe('mapIdbError', () => {
  it('maps an exhausted storage quota to 507, the status a caller can act on', () => {
    const error = mapIdbError(new DOMException('no room left', 'QuotaExceededError'))

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(507)
    expect(error.message).toContain('Not enough browser storage left to save this plan')
  })

  it('replaces the browser’s quota wording with something the user can act on', () => {
    const error = mapIdbError(new DOMException('no room left', 'QuotaExceededError'))

    expect(error.message).not.toContain('no room left')
    expect(error.message).toContain('Export it to a file')
    expect(error.message).toContain('delete archived plans')
  })

  it('maps a violated uniqueness constraint to 409', () => {
    expect(mapIdbError(new DOMException('duplicate key', 'ConstraintError')).status).toBe(409)
  })

  it('maps any other storage failure to 500', () => {
    expect(mapIdbError(new DOMException('boom', 'UnknownError')).status).toBe(500)
    expect(mapIdbError(new Error('boom')).status).toBe(500)
    expect(mapIdbError(null).status).toBe(500)
  })

  it('classifies by name alone, since a storage error is not always a DOMException', () => {
    expect(mapIdbError({ name: 'QuotaExceededError', message: 'full' }).status).toBe(507)
  })

  it('passes an ApiError through so an adapter status survives a transaction', () => {
    const original = new ApiError(404, "Plan 'p1' not found.")

    expect(mapIdbError(original)).toBe(original)
  })
})

describe('addIfAbsent', () => {
  beforeEach(async () => {
    await resetBrowserDb()
  })

  it('keeps the first value for a key and lets the transaction commit', async () => {
    const db = await openDb()
    const key = { plan_id: 'p1', from_version: 1 }

    const inserted = await runTransaction(
      db,
      DOCUMENT_BACKUPS_STORE,
      'readwrite',
      async (transaction) => {
        const store = transaction.objectStore(DOCUMENT_BACKUPS_STORE)
        const first = await addIfAbsent(store, {
          ...key,
          document: { v: 'first' },
          created_at: 'a',
        })
        const second = await addIfAbsent(store, {
          ...key,
          document: { v: 'second' },
          created_at: 'b',
        })
        return { first, second }
      },
    )

    expect(inserted).toEqual({ first: true, second: false })
    const db2 = await openDb()
    const stored = await runTransaction(db2, DOCUMENT_BACKUPS_STORE, 'readonly', (transaction) =>
      requestResult<{ document: { v: string } } | undefined>(
        transaction.objectStore(DOCUMENT_BACKUPS_STORE).get([key.plan_id, key.from_version]),
      ),
    )
    expect(stored?.document).toEqual({ v: 'first' })
  })
})

describe('runTransaction', () => {
  beforeEach(async () => {
    await resetBrowserDb()
  })

  it('rolls the whole transaction back when the body throws', async () => {
    const db = await openDb()

    const error = await runTransaction(
      db,
      DOCUMENT_BACKUPS_STORE,
      'readwrite',
      async (transaction) => {
        await requestResult(
          transaction
            .objectStore(DOCUMENT_BACKUPS_STORE)
            .add({ plan_id: 'p1', from_version: 1, document: {}, created_at: 'a' }),
        )
        throw new ApiError(409, 'giving up half way')
      },
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(409)
    const backups = await runTransaction(db, DOCUMENT_BACKUPS_STORE, 'readonly', (transaction) =>
      requestResult<number>(transaction.objectStore(DOCUMENT_BACKUPS_STORE).count()),
    )
    expect(backups).toBe(0)
  })
})

describe('withQuotaMessage', () => {
  it('restates a quota failure for the write that hit it', async () => {
    const error = await withQuotaMessage('No room for this image.', () =>
      Promise.reject(new DOMException('no room left', 'QuotaExceededError')),
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(507)
    expect((error as ApiError).message).toBe('No room for this image.')
  })

  it('leaves every other failure exactly as mapIdbError classified it', async () => {
    const error = await withQuotaMessage('No room for this image.', () =>
      Promise.reject(new DOMException('duplicate key', 'ConstraintError')),
    ).catch((e: unknown) => e)

    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).message).toContain('duplicate key')
  })

  it('passes a successful write straight through', async () => {
    await expect(withQuotaMessage('unused', () => Promise.resolve('stored'))).resolves.toBe(
      'stored',
    )
  })
})
