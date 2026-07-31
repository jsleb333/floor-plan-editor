import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import { insertAsset } from '@/persistence/browser/assetRecords'
import { browserPlansPort } from '@/persistence/browser/browserPlansAdapter'
import { createDefaultPlanDocument } from '@/persistence/browser/planDocumentDefaults'
import { CURRENT_SCHEMA_VERSION } from '@/schema/planDocumentSchema'
import {
  putRawDocument,
  readDocumentBackups,
  readRawDocument,
  resetBrowserDb,
} from '../../helpers/browserDb'
import { makeDocument, makeWall } from '../../helpers/planFactory'

const {
  archivePlan,
  createPlan,
  deletePlan,
  duplicatePlan,
  getPlan,
  listPlans,
  restorePlan,
  savePlanDocument,
  updatePlanMetadata,
} = browserPlansPort

const START_TIME = '2026-01-01T10:00:00.000Z'
const LATER_TIME = '2026-01-02T11:30:00.000Z'

/** A uuid with dashes, as `crypto.randomUUID` and the backend's `str(uuid4())` both produce. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function setNow(iso: string): void {
  vi.setSystemTime(new Date(iso))
}

/**
 * Stores an asset whose bytes nothing in these tests reads: plan creation only
 * checks that the underlay id resolves to something.
 */
async function seedAsset(id: string): Promise<void> {
  await insertAsset({
    id,
    content_type: 'image/png',
    size_bytes: 3,
    created_at: START_TIME,
    blob: new Blob(['png'], { type: 'image/png' }),
  })
}

async function status(promise: Promise<unknown>): Promise<number | undefined> {
  const error: unknown = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  return error instanceof ApiError ? error.status : undefined
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  setNow(START_TIME)
  await resetBrowserDb()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('createDefaultPlanDocument', () => {
  it('builds the same empty document the backend seeds a new plan with', () => {
    expect(createDefaultPlanDocument()).toEqual(makeDocument())
  })

  it('references an underlay with the DEFAULT transform, not a fitted one', () => {
    const document = createDefaultPlanDocument({ underlay_asset_id: 'asset-1' })

    expect(document.underlay).toEqual({
      image_ref: 'asset-1',
      transform: { origin: { x: 0, y: 0 }, rotation_deg: 0, scale: 1 },
      opacity: 0.4,
      locked: false,
      visible: true,
    })
  })

  it('seeds the tier-2 settings from the creation card', () => {
    const document = createDefaultPlanDocument({
      thickness_presets_in: [10, 6, 4],
      display_precision_in: 0.25,
    })

    expect(document.thickness_presets_in).toEqual([10, 6, 4])
    expect(document.display_precision_in).toBe(0.25)
  })
})

describe('createPlan', () => {
  it('starts at revision 1 with a dashed uuid and the default document', async () => {
    const plan = await createPlan('Basement')

    expect(plan.id).toMatch(UUID_PATTERN)
    expect(plan.revision).toBe(1)
    expect(plan.name).toBe('Basement')
    expect(plan.description).toBe('')
    expect(plan.archived_at).toBeNull()
    expect(plan.created_at).toBe(START_TIME)
    expect(plan.updated_at).toBe(START_TIME)
    expect(plan.document).toEqual(makeDocument())
  })

  it('stores what it returns, so the next read agrees with the creation response', async () => {
    const created = await createPlan('Basement', { description: 'Lower floor' })

    await expect(getPlan(created.id)).resolves.toEqual(created)
  })

  it('seeds the underlay from an uploaded asset', async () => {
    await seedAsset('asset-1')

    const plan = await createPlan('Traced', { underlay_asset_id: 'asset-1' })

    expect(plan.document.underlay).toEqual(
      createDefaultPlanDocument({ underlay_asset_id: 'asset-1' }).underlay,
    )
  })

  it('refuses an underlay asset that was never uploaded with a 404', async () => {
    expect(await status(createPlan('Traced', { underlay_asset_id: 'missing' }))).toBe(404)
    await expect(listPlans()).resolves.toEqual([])
  })
})

describe('getPlan', () => {
  it('rejects an unknown id with a 404', async () => {
    expect(await status(getPlan('missing'))).toBe(404)
  })

  it('repairs a legacy document, persists it and keeps exactly one backup', async () => {
    const created = await createPlan('Basement')
    await putRawDocument(created.id, {
      schema_version: 1,
      walls: [
        {
          id: 'w1',
          vertices: [
            { x: 0, y: 0 },
            { x: 120, y: 0 },
          ],
          thickness_in: 3.5,
        },
      ],
    })
    setNow(LATER_TIME)

    const plan = await getPlan(created.id)

    expect(plan.document.schema_version).toBe(CURRENT_SCHEMA_VERSION)
    expect(plan.document.walls).toEqual([makeWall({ id: 'w1' })])
    expect(plan.revision).toBe(2)
    expect(plan.updated_at).toBe(LATER_TIME)
    await expect(readRawDocument(created.id)).resolves.toMatchObject({
      schema_version: CURRENT_SCHEMA_VERSION,
    })
    const backups = await readDocumentBackups(created.id)
    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatchObject({ from_version: 1, created_at: LATER_TIME })
    expect(backups[0]?.document).toMatchObject({ schema_version: 1 })
  })

  it('does not back the document up a second time once it has been repaired', async () => {
    const created = await createPlan('Basement')
    await putRawDocument(created.id, { schema_version: 1, walls: [] })
    const first = await getPlan(created.id)

    const second = await getPlan(created.id)

    expect(second.revision).toBe(first.revision)
    await expect(readDocumentBackups(created.id)).resolves.toHaveLength(1)
  })

  it('backs up a current-version document that had to be repaired', async () => {
    const created = await createPlan('Basement')
    await putRawDocument(created.id, {
      ...makeDocument(),
      walls: [{ id: 'w1', vertices: [], thickness_in: 3.5 }],
    })

    const plan = await getPlan(created.id)

    expect(plan.document.walls).toEqual([])
    const backups = await readDocumentBackups(created.id)
    expect(backups).toHaveLength(1)
    expect(backups[0]?.from_version).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('leaves a readable current-version document untouched', async () => {
    const created = await createPlan('Basement')

    const plan = await getPlan(created.id)

    expect(plan.revision).toBe(1)
    expect(plan.updated_at).toBe(START_TIME)
    await expect(readDocumentBackups(created.id)).resolves.toEqual([])
  })
})

describe('savePlanDocument', () => {
  it('bumps the revision and stores the document', async () => {
    const created = await createPlan('Basement')
    const document = makeDocument({ walls: [makeWall()] })
    setNow(LATER_TIME)

    const result = await savePlanDocument(created.id, { revision: 1, document })

    expect(result).toEqual({ revision: 2 })
    const reloaded = await getPlan(created.id)
    expect(reloaded.document.walls).toEqual([makeWall()])
    expect(reloaded.revision).toBe(2)
    expect(reloaded.updated_at).toBe(LATER_TIME)
  })

  it('stamps the schema version to the current one on write', async () => {
    const created = await createPlan('Basement')

    await savePlanDocument(created.id, {
      revision: 1,
      document: makeDocument({ schema_version: 3 }),
    })

    await expect(readRawDocument(created.id)).resolves.toMatchObject({
      schema_version: CURRENT_SCHEMA_VERSION,
    })
    await expect(readDocumentBackups(created.id)).resolves.toEqual([])
  })

  it('rejects a stale revision with a 409 and leaves the stored state alone', async () => {
    const created = await createPlan('Basement')
    await savePlanDocument(created.id, { revision: 1, document: makeDocument() })
    const winning = makeDocument({ walls: [makeWall()] })
    await savePlanDocument(created.id, { revision: 2, document: winning })

    const conflicted = savePlanDocument(created.id, {
      revision: 2,
      document: makeDocument({ walls: [makeWall({ id: 'loser' })] }),
    })

    expect(await status(conflicted)).toBe(409)
    const reloaded = await getPlan(created.id)
    expect(reloaded.revision).toBe(3)
    expect(reloaded.document.walls).toEqual(winning.walls)
  })

  it('rejects a write to an unknown plan with a 404', async () => {
    expect(
      await status(savePlanDocument('missing', { revision: 1, document: makeDocument() })),
    ).toBe(404)
  })

  it('surfaces an exhausted storage quota as a 507 and rolls the write back', async () => {
    const created = await createPlan('Basement')
    const nativeStructuredClone = globalThis.structuredClone
    vi.stubGlobal('structuredClone', (value: unknown): unknown => {
      if (typeof value === 'object' && value !== null && 'document' in value) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      }
      return nativeStructuredClone(value)
    })

    const failed = savePlanDocument(created.id, {
      revision: 1,
      document: makeDocument({ walls: [makeWall()] }),
    })

    expect(await status(failed)).toBe(507)
    vi.unstubAllGlobals()
    const reloaded = await getPlan(created.id)
    expect(reloaded.revision).toBe(1)
    expect(reloaded.document.walls).toEqual([])
  })
})

describe('updatePlanMetadata', () => {
  it('bumps updated_at but not the revision, and returns the full plan', async () => {
    const created = await createPlan('Basement', { description: 'Lower floor' })
    setNow(LATER_TIME)

    const plan = await updatePlanMetadata(created.id, { name: 'Cellar' })

    expect(plan.name).toBe('Cellar')
    expect(plan.description).toBe('Lower floor')
    expect(plan.revision).toBe(1)
    expect(plan.updated_at).toBe(LATER_TIME)
    expect(plan.created_at).toBe(START_TIME)
    expect(plan.document).toEqual(makeDocument())
  })

  it('rejects an unknown id with a 404', async () => {
    expect(await status(updatePlanMetadata('missing', { name: 'Cellar' }))).toBe(404)
  })
})

describe('listPlans', () => {
  it('returns summaries most recently updated first, without the documents', async () => {
    setNow('2026-01-01T00:00:00.000Z')
    const first = await createPlan('First')
    setNow('2026-01-02T00:00:00.000Z')
    const second = await createPlan('Second')
    setNow('2026-01-03T00:00:00.000Z')
    const third = await createPlan('Third')

    const summaries = await listPlans()

    expect(summaries.map((summary) => summary.id)).toEqual([third.id, second.id, first.id])
    expect(summaries[0]).toEqual({
      id: third.id,
      name: 'Third',
      description: '',
      updated_at: '2026-01-03T00:00:00.000Z',
      archived_at: null,
    })
  })

  it('reorders when a plan is saved, because the order is the index and not insertion', async () => {
    setNow('2026-01-01T00:00:00.000Z')
    const first = await createPlan('First')
    setNow('2026-01-02T00:00:00.000Z')
    const second = await createPlan('Second')
    setNow('2026-01-03T00:00:00.000Z')
    await savePlanDocument(first.id, { revision: 1, document: makeDocument() })

    const summaries = await listPlans()

    expect(summaries.map((summary) => summary.id)).toEqual([first.id, second.id])
  })

  it('lists archived plans too, so the home page can offer to restore them', async () => {
    const created = await createPlan('Basement')
    setNow(LATER_TIME)
    await archivePlan(created.id)

    const summaries = await listPlans()

    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.archived_at).toBe(LATER_TIME)
  })
})

describe('duplicatePlan', () => {
  it('copies the document into a new plan named "<name> (copy)" at revision 1', async () => {
    const source = await createPlan('Basement', { description: 'Lower floor' })
    await savePlanDocument(source.id, {
      revision: 1,
      document: makeDocument({ walls: [makeWall()] }),
    })
    setNow(LATER_TIME)

    const copy = await duplicatePlan(source.id)

    expect(copy.name).toBe('Basement (copy)')
    expect(copy.description).toBe('Lower floor')
    expect(copy.id).not.toBe(source.id)
    expect(copy.revision).toBe(1)
    expect(copy.archived_at).toBeNull()
    expect(copy.created_at).toBe(LATER_TIME)
    expect(copy.document.walls).toEqual([makeWall()])
  })

  it('deep-copies the document, so editing the source does not edit the copy', async () => {
    const source = await createPlan('Basement')
    const copy = await duplicatePlan(source.id)

    await savePlanDocument(source.id, {
      revision: 1,
      document: makeDocument({ walls: [makeWall()] }),
    })

    await expect(getPlan(copy.id)).resolves.toMatchObject({ document: { walls: [] } })
  })

  it('rejects an unknown id with a 404', async () => {
    expect(await status(duplicatePlan('missing'))).toBe(404)
  })
})

describe('archivePlan and restorePlan', () => {
  it('stamps and clears archived_at without touching the revision', async () => {
    const created = await createPlan('Basement')
    setNow(LATER_TIME)

    const archived = await archivePlan(created.id)
    const restored = await restorePlan(created.id)

    expect(archived.archived_at).toBe(LATER_TIME)
    expect(archived.updated_at).toBe(LATER_TIME)
    expect(archived.revision).toBe(1)
    expect(restored.archived_at).toBeNull()
    expect(restored.revision).toBe(1)
  })

  it('rejects an unknown id with a 404', async () => {
    expect(await status(archivePlan('missing'))).toBe(404)
    expect(await status(restorePlan('missing'))).toBe(404)
  })
})

describe('deletePlan', () => {
  it('refuses a plan that was not archived first, and keeps it', async () => {
    const created = await createPlan('Basement')

    expect(await status(deletePlan(created.id))).toBe(409)
    await expect(getPlan(created.id)).resolves.toMatchObject({ id: created.id })
  })

  it('removes an archived plan and its document', async () => {
    const created = await createPlan('Basement')
    await archivePlan(created.id)

    await deletePlan(created.id)

    expect(await status(getPlan(created.id))).toBe(404)
    await expect(listPlans()).resolves.toEqual([])
    await expect(readRawDocument(created.id)).resolves.toBeUndefined()
  })

  it('rejects an unknown id with a 404', async () => {
    expect(await status(deletePlan('missing'))).toBe(404)
  })
})
