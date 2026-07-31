import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  ASSETS_STORE,
  DOCUMENT_BACKUPS_STORE,
  PLAN_DOCUMENTS_STORE,
  PLANS_STORE,
  UPDATED_AT_INDEX,
  closeDb,
  openDb,
} from '@/persistence/browser/db'
import { resetBrowserDb } from '../../helpers/browserDb'

describe('openDb', () => {
  beforeEach(async () => {
    await resetBrowserDb()
  })

  it('creates all four object stores on the upgrade path', async () => {
    const db = await openDb()

    expect([...db.objectStoreNames].sort()).toEqual(
      [ASSETS_STORE, DOCUMENT_BACKUPS_STORE, PLAN_DOCUMENTS_STORE, PLANS_STORE].sort(),
    )
  })

  it('keys each store the way its rows are addressed', async () => {
    const db = await openDb()
    const transaction = db.transaction([...db.objectStoreNames], 'readonly')

    expect(transaction.objectStore(PLANS_STORE).keyPath).toBe('id')
    expect(transaction.objectStore(PLAN_DOCUMENTS_STORE).keyPath).toBe('id')
    expect(transaction.objectStore(ASSETS_STORE).keyPath).toBe('id')
    expect(transaction.objectStore(DOCUMENT_BACKUPS_STORE).keyPath).toEqual([
      'plan_id',
      'from_version',
    ])
  })

  it('indexes plans by updated_at, which is what makes the listing order an index walk', async () => {
    const db = await openDb()
    const index = db
      .transaction(PLANS_STORE, 'readonly')
      .objectStore(PLANS_STORE)
      .index(UPDATED_AT_INDEX)

    expect(index.keyPath).toBe('updated_at')
    expect(index.unique).toBe(false)
  })

  it('hands every caller the same connection instead of opening one per call', async () => {
    const [first, second] = await Promise.all([openDb(), openDb()])

    expect(first).toBe(second)
  })

  it('reopens after the connection is closed, so a versionchange is not fatal', async () => {
    const first = await openDb()
    await closeDb()

    const second = await openDb()

    expect(second).not.toBe(first)
    expect([...second.objectStoreNames]).toContain(PLANS_STORE)
  })
})
