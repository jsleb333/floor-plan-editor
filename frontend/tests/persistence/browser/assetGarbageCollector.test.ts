import 'fake-indexeddb/auto'

import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { collectOrphanAssets } from '@/persistence/browser/assetGarbageCollector'
import { assetExists, insertAsset } from '@/persistence/browser/assetRecords'
import { browserPlansPort } from '@/persistence/browser/browserPlansAdapter'
import { putRawDocument, resetBrowserDb } from '../../helpers/browserDb'
import { makeDocument } from '../../helpers/planFactory'

const { archivePlan, createPlan, deletePlan, duplicatePlan, savePlanDocument } = browserPlansPort

const START_TIME = '2026-01-01T10:00:00.000Z'
/** Well past the collector's settling window, so nothing is protected by its age. */
const SWEEP_TIME = '2026-01-01T10:05:00.000Z'

const originalOpenCursor = IDBObjectStore.prototype.openCursor

function setNow(iso: string): void {
  vi.setSystemTime(new Date(iso))
}

/** Stores an asset whose bytes nothing reads; only its id and age matter here. */
async function seedAsset(id: string): Promise<void> {
  await insertAsset({
    id,
    content_type: 'image/png',
    size_bytes: 3,
    created_at: new Date().toISOString(),
    blob: new Blob(['png'], { type: 'image/png' }),
  })
}

/** An archived plan tracing `assetId`, which is what makes the asset referenced. */
async function seedTracedPlan(name: string, assetId: string): Promise<string> {
  await seedAsset(assetId)
  const plan = await createPlan(name, { underlay_asset_id: assetId })
  return plan.id
}

/**
 * Makes the nth `openCursor` of the next sweep throw, standing in for storage
 * that goes away part-way through the scan. Call 1 walks the documents, call 2
 * walks the assets, so `2` fails a scan that has already read half the truth.
 */
function failOpenCursorOnCall(nth: number): void {
  let calls = 0
  IDBObjectStore.prototype.openCursor = function (
    this: IDBObjectStore,
    query?: IDBValidKey | IDBKeyRange | null,
    direction?: IDBCursorDirection,
  ): IDBRequest<IDBCursorWithValue | null> {
    calls += 1
    if (calls === nth) throw new DOMException('the storage went away', 'UnknownError')
    return originalOpenCursor.call(this, query, direction)
  }
}

beforeEach(async () => {
  // jsdom's Blob does not survive the structured clone IndexedDB stores values
  // with; Node's does, so assets are exercised against real blob semantics.
  vi.stubGlobal('Blob', NodeBlob)
  vi.useFakeTimers({ toFake: ['Date'] })
  setNow(START_TIME)
  await resetBrowserDb()
})

afterEach(() => {
  IDBObjectStore.prototype.openCursor = originalOpenCursor
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('collectOrphanAssets', () => {
  it('removes an image the deleted plan was the last to reference', async () => {
    const planId = await seedTracedPlan('Basement', 'asset-1')
    await archivePlan(planId)
    await deletePlan(planId)
    setNow(SWEEP_TIME)

    await expect(collectOrphanAssets()).resolves.toEqual(['asset-1'])
    await expect(assetExists('asset-1')).resolves.toBe(false)
  })

  it('keeps an image an active plan still traces', async () => {
    await seedTracedPlan('Basement', 'asset-1')
    setNow(SWEEP_TIME)

    await expect(collectOrphanAssets()).resolves.toEqual([])
    await expect(assetExists('asset-1')).resolves.toBe(true)
  })

  it('keeps an image only an ARCHIVED plan traces, because archiving is not deletion', async () => {
    const planId = await seedTracedPlan('Basement', 'asset-1')
    await archivePlan(planId)
    setNow(SWEEP_TIME)

    await expect(collectOrphanAssets()).resolves.toEqual([])
    await expect(assetExists('asset-1')).resolves.toBe(true)
  })

  it('keeps an image two plans share, so deleting one copy of a duplicate is safe', async () => {
    const planId = await seedTracedPlan('Basement', 'asset-1')
    const copy = await duplicatePlan(planId)
    expect(copy.document.underlay?.image_ref).toBe('asset-1')

    await archivePlan(planId)
    await deletePlan(planId)
    setNow(SWEEP_TIME)

    await expect(collectOrphanAssets()).resolves.toEqual([])
    await expect(assetExists('asset-1')).resolves.toBe(true)
  })

  it('removes the image a re-import replaced, the orphan no flow used to clean up', async () => {
    const planId = await seedTracedPlan('Basement', 'first')
    await seedAsset('second')
    const traced = makeDocument({
      underlay: {
        image_ref: 'second',
        transform: { origin: { x: 0, y: 0 }, rotation_deg: 0, scale: 1 },
        opacity: 0.4,
        locked: false,
        visible: true,
      },
    })
    await savePlanDocument(planId, { revision: 1, document: traced })
    setNow(SWEEP_TIME)

    await expect(collectOrphanAssets()).resolves.toEqual(['first'])
    await expect(assetExists('second')).resolves.toBe(true)
  })

  it('keeps an image younger than the settling window, whose document may be unwritten', async () => {
    await seedAsset('asset-1')

    await expect(collectOrphanAssets()).resolves.toEqual([])
    await expect(assetExists('asset-1')).resolves.toBe(true)
  })

  it('aborts the sweep on a document it cannot read rather than assuming it references nothing', async () => {
    const planId = await seedTracedPlan('Basement', 'asset-1')
    const orphanHolder = await createPlan('Notes')
    await putRawDocument(orphanHolder.id, 'not a document at all')
    await archivePlan(planId)
    await deletePlan(planId)
    setNow(SWEEP_TIME)

    await expect(collectOrphanAssets()).resolves.toEqual([])
    await expect(assetExists('asset-1')).resolves.toBe(true)
  })

  it('aborts on an underlay whose image_ref is not a string, the shape a repair would erase', async () => {
    const planId = await seedTracedPlan('Basement', 'asset-1')
    const holder = await createPlan('Notes')
    await putRawDocument(holder.id, { ...makeDocument(), underlay: { image_ref: 42 } })
    await archivePlan(planId)
    await deletePlan(planId)
    setNow(SWEEP_TIME)

    await expect(collectOrphanAssets()).resolves.toEqual([])
    await expect(assetExists('asset-1')).resolves.toBe(true)
  })

  it('collects nothing when the scan fails part-way through', async () => {
    const planId = await seedTracedPlan('Basement', 'asset-1')
    await archivePlan(planId)
    await deletePlan(planId)
    setNow(SWEEP_TIME)
    failOpenCursorOnCall(2)

    await expect(collectOrphanAssets()).resolves.toEqual([])
    IDBObjectStore.prototype.openCursor = originalOpenCursor
    await expect(assetExists('asset-1')).resolves.toBe(true)
  })

  it('collects nothing when the scan fails before it reads a single document', async () => {
    const planId = await seedTracedPlan('Basement', 'asset-1')
    await archivePlan(planId)
    await deletePlan(planId)
    setNow(SWEEP_TIME)
    failOpenCursorOnCall(1)

    await expect(collectOrphanAssets()).resolves.toEqual([])
    IDBObjectStore.prototype.openCursor = originalOpenCursor
    await expect(assetExists('asset-1')).resolves.toBe(true)
  })

  it('reports an empty sweep on a database with nothing stored', async () => {
    await expect(collectOrphanAssets()).resolves.toEqual([])
  })
})

describe('deletePlan', () => {
  it('takes the plan’s traced photo with it, which is where the freed space comes from', async () => {
    setNow(START_TIME)
    const planId = await seedTracedPlan('Basement', 'asset-1')
    await archivePlan(planId)
    setNow(SWEEP_TIME)

    await deletePlan(planId)

    await expect(assetExists('asset-1')).resolves.toBe(false)
  })

  it('leaves the photo alone when a duplicate of the plan still traces it', async () => {
    setNow(START_TIME)
    const planId = await seedTracedPlan('Basement', 'asset-1')
    await duplicatePlan(planId)
    await archivePlan(planId)
    setNow(SWEEP_TIME)

    await deletePlan(planId)

    await expect(assetExists('asset-1')).resolves.toBe(true)
  })

  it('still reports success when the sweep behind it cannot run', async () => {
    setNow(START_TIME)
    const planId = await seedTracedPlan('Basement', 'asset-1')
    await archivePlan(planId)
    setNow(SWEEP_TIME)
    failOpenCursorOnCall(1)

    await expect(deletePlan(planId)).resolves.toBeUndefined()
    IDBObjectStore.prototype.openCursor = originalOpenCursor
    await expect(assetExists('asset-1')).resolves.toBe(true)
  })
})
