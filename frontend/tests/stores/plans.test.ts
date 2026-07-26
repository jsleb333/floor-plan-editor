import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePlansStore } from '@/stores/plans'

import { makeDocument, makePlan, makeWall } from '../helpers/planFactory'

vi.mock('@/api/plans', () => ({
  listPlans: vi.fn(),
  createPlan: vi.fn(),
  getPlan: vi.fn(),
  savePlanDocument: vi.fn(),
  updatePlanMetadata: vi.fn(),
  duplicatePlan: vi.fn(),
  archivePlan: vi.fn(),
  restorePlan: vi.fn(),
  deletePlan: vi.fn(),
}))

import { createPlan, getPlan, savePlanDocument, updatePlanMetadata } from '@/api/plans'

const getPlanMock = vi.mocked(getPlan)
const createPlanMock = vi.mocked(createPlan)
const savePlanDocumentMock = vi.mocked(savePlanDocument)
const updatePlanMetadataMock = vi.mocked(updatePlanMetadata)

describe('usePlansStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('getDocument fetches a plan document once per id, sharing the result', async () => {
    const plan = makePlan({ id: 'p1', document: makeDocument({ walls: [makeWall()] }) })
    getPlanMock.mockResolvedValue(plan)
    const store = usePlansStore()

    const [a, b] = await Promise.all([store.getDocument('p1'), store.getDocument('p1')])
    const c = await store.getDocument('p1')

    expect(getPlanMock).toHaveBeenCalledTimes(1)
    expect(a).toEqual(plan.document)
    expect(b).toEqual(plan.document)
    expect(c).toEqual(plan.document)
  })

  it('importPlan creates the plan, saves the document, and caches it without refetching', async () => {
    // createPlan(name) returns a plan already named `name` (server-assigned).
    const created = makePlan({ id: 'new', revision: 0, name: 'Imported plan' })
    createPlanMock.mockResolvedValue(created)
    savePlanDocumentMock.mockResolvedValue({ revision: 1 })
    const document = makeDocument({ walls: [makeWall()] })
    const store = usePlansStore()

    const imported = await store.importPlan('Imported plan', document)

    expect(createPlanMock).toHaveBeenCalledWith('Imported plan')
    expect(savePlanDocumentMock).toHaveBeenCalledWith('new', { revision: 0, document })
    expect(imported.document).toEqual(document)
    expect(store.plans[0]).toMatchObject({ id: 'new', name: 'Imported plan' })

    const cached = await store.getDocument('new')
    expect(cached).toEqual(document)
    expect(getPlanMock).not.toHaveBeenCalled()
  })

  it('create passes the creation-card options through and lists the new plan first', async () => {
    // The card only sends what the user set (spec P5); the store must not
    // add, drop or rename any field on the way to the API.
    const created = makePlan({ id: 'new', name: 'Garage', description: 'Two-car garage' })
    createPlanMock.mockResolvedValue(created)
    const store = usePlansStore()
    const options = {
      description: 'Two-car garage',
      underlay_asset_id: 'asset-9',
      thickness_presets_in: [12, 6],
      display_precision_in: 0.25,
    }

    const plan = await store.create('Garage', options)

    expect(createPlanMock).toHaveBeenCalledWith('Garage', options)
    expect(plan).toEqual(created)
    expect(store.plans[0]).toMatchObject({
      id: 'new',
      name: 'Garage',
      description: 'Two-car garage',
    })
  })

  it('updateMetadata patches the plan and refreshes its summary in place', async () => {
    const listed = makePlan({ id: 'p1', name: 'Basement' })
    getPlanMock.mockResolvedValue(listed)
    const patched = makePlan({ id: 'p1', name: 'Basement', description: 'Reno 2026' })
    updatePlanMetadataMock.mockResolvedValue(patched)
    const store = usePlansStore()
    store.plans = [
      {
        id: 'p1',
        name: 'Basement',
        description: '',
        updated_at: '2026-07-01T00:00:00Z',
        archived_at: null,
      },
    ]

    await store.updateMetadata('p1', { description: 'Reno 2026' })

    expect(updatePlanMetadataMock).toHaveBeenCalledWith('p1', { description: 'Reno 2026' })
    expect(store.plans[0]).toMatchObject({ id: 'p1', description: 'Reno 2026' })
  })

  it('rename routes through the metadata patch endpoint', async () => {
    const renamed = makePlan({ id: 'p1', name: 'Cellar' })
    updatePlanMetadataMock.mockResolvedValue(renamed)
    const store = usePlansStore()
    store.plans = [
      {
        id: 'p1',
        name: 'Basement',
        description: '',
        updated_at: '2026-07-01T00:00:00Z',
        archived_at: null,
      },
    ]

    await store.rename('p1', 'Cellar')

    expect(updatePlanMetadataMock).toHaveBeenCalledWith('p1', { name: 'Cellar' })
    expect(store.plans[0]).toMatchObject({ id: 'p1', name: 'Cellar' })
  })
})
