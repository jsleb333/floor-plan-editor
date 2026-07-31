import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requestPersistentStorage } from '@/persistence/browser/storagePersistence'

/** A stand-in for the slice of `StorageManager` this module touches. */
interface FakeStorageManager {
  persisted: () => Promise<boolean>
  persist: () => Promise<boolean>
}

function installStorageManager(manager: Partial<FakeStorageManager> | null): void {
  if (manager === null) {
    Reflect.deleteProperty(navigator, 'storage')
    return
  }
  Object.defineProperty(navigator, 'storage', { configurable: true, value: manager })
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  installStorageManager(null)
  window.localStorage.clear()
})

describe('requestPersistentStorage', () => {
  it('declines quietly on a browser without the API rather than throwing at a caller', async () => {
    installStorageManager(null)

    await expect(requestPersistentStorage()).resolves.toBe(false)
  })

  it('reports success without asking again when the origin is already persistent', async () => {
    const persist = vi.fn(() => Promise.resolve(true))
    installStorageManager({ persisted: () => Promise.resolve(true), persist })

    await expect(requestPersistentStorage()).resolves.toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('asks the browser once and remembers it, so no later save can prompt again', async () => {
    const persist = vi.fn(() => Promise.resolve(true))
    installStorageManager({ persisted: () => Promise.resolve(false), persist })

    await expect(requestPersistentStorage()).resolves.toBe(true)
    await expect(requestPersistentStorage()).resolves.toBe(false)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('does not re-ask after a refusal, which is the case that would nag every session', async () => {
    const persist = vi.fn(() => Promise.resolve(false))
    installStorageManager({ persisted: () => Promise.resolve(false), persist })

    await expect(requestPersistentStorage()).resolves.toBe(false)
    await expect(requestPersistentStorage()).resolves.toBe(false)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('swallows a rejection, because a refused hint must never reach the save that triggered it', async () => {
    installStorageManager({
      persisted: () => Promise.resolve(false),
      persist: () => Promise.reject(new Error('permission dismissed')),
    })

    await expect(requestPersistentStorage()).resolves.toBe(false)
  })

  it('survives a storage API that throws while reporting the current state', async () => {
    installStorageManager({
      persisted: () => Promise.reject(new Error('unavailable')),
      persist: () => Promise.resolve(true),
    })

    await expect(requestPersistentStorage()).resolves.toBe(false)
  })
})
