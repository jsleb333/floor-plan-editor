import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePlansStore } from '@/stores/plans'

import { makeDocument, makePlan, makeWall } from '../helpers/planFactory'

vi.mock('@/api/plans', () => ({
  listPlans: vi.fn(),
  createPlan: vi.fn(),
  getPlan: vi.fn(),
  savePlanDocument: vi.fn(),
  renamePlan: vi.fn(),
  duplicatePlan: vi.fn(),
  archivePlan: vi.fn(),
  restorePlan: vi.fn(),
  deletePlan: vi.fn(),
}))

import { createPlan, getPlan, savePlanDocument } from '@/api/plans'

const getPlanMock = vi.mocked(getPlan)
const createPlanMock = vi.mocked(createPlan)
const savePlanDocumentMock = vi.mocked(savePlanDocument)

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
})
