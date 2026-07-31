import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PlanCreateCard from '@/components/PlanCreateCard.vue'

import { makePlan } from '../helpers/planFactory'

vi.mock('@/persistence/plans', () => ({
  createPlan: vi.fn(),
  updatePlanMetadata: vi.fn(),
}))

vi.mock('@/persistence/assets', () => ({
  uploadAsset: vi.fn(),
  resolveAssetUrl: vi.fn(),
  readAssetBlob: vi.fn(),
}))

import { uploadAsset } from '@/persistence/assets'
import { createPlan } from '@/persistence/plans'

const createPlanMock = vi.mocked(createPlan)
const uploadAssetMock = vi.mocked(uploadAsset)

describe('PlanCreateCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // jsdom has no object-URL support; the thumbnail preview needs both ends.
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
  })

  function mountCard() {
    return mount(PlanCreateCard, { attachTo: document.body })
  }

  async function setName(wrapper: ReturnType<typeof mountCard>, name: string): Promise<void> {
    await wrapper.get('input[aria-label="New plan name"]').setValue(name)
  }

  async function attachPhoto(
    wrapper: ReturnType<typeof mountCard>,
    file: File = new File(['img'], 'plan.jpg', { type: 'image/jpeg' }),
  ): Promise<void> {
    await wrapper
      .get('button[aria-label="Add an underlay photo"]')
      .trigger('drop', { dataTransfer: { files: [file] } })
  }

  it('disables Create until a name is typed', async () => {
    const wrapper = mountCard()

    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await setName(wrapper, 'Basement')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
  })

  it('creates with only the name when nothing else was touched, and emits the plan', async () => {
    const plan = makePlan({ id: 'new' })
    createPlanMock.mockResolvedValue(plan)
    const wrapper = mountCard()
    await setName(wrapper, ' Basement ')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    // Untouched defaults are omitted so the backend seeds its own (spec P5).
    expect(createPlanMock).toHaveBeenCalledWith('Basement', {})
    expect(uploadAssetMock).not.toHaveBeenCalled()
    expect(wrapper.emitted('created')).toEqual([[plan]])
  })

  it('sends the description and the changed defaults only', async () => {
    createPlanMock.mockResolvedValue(makePlan({ id: 'new' }))
    const wrapper = mountCard()
    await setName(wrapper, 'Basement')
    await wrapper.get('input[aria-label="New plan description"]').setValue('Reno 2026')
    await wrapper.get('section[aria-label="Defaults"] > button').trigger('click')
    await wrapper.get('select[aria-label="Display precision"]').setValue('0.25')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(createPlanMock).toHaveBeenCalledWith('Basement', {
      description: 'Reno 2026',
      display_precision_in: 0.25,
    })
  })

  it('sends edited thickness presets', async () => {
    createPlanMock.mockResolvedValue(makePlan({ id: 'new' }))
    const wrapper = mountCard()
    await setName(wrapper, 'Basement')
    await wrapper.get('section[aria-label="Defaults"] > button').trigger('click')
    const firstPreset = wrapper.get('input[aria-label="Thickness preset 1"]')
    await firstPreset.setValue('10')
    await firstPreset.trigger('blur')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(createPlanMock).toHaveBeenCalledWith('Basement', {
      thickness_presets_in: [10, 4.5, 3.5],
    })
  })

  it('uploads the photo on submit — not on drop — and creates with the asset id', async () => {
    uploadAssetMock.mockResolvedValue({
      id: 'asset-9',
      content_type: 'image/jpeg',
      size_bytes: 3,
      created_at: '2026-07-01T00:00:00Z',
    })
    const plan = makePlan({ id: 'new' })
    createPlanMock.mockResolvedValue(plan)
    const wrapper = mountCard()
    await setName(wrapper, 'Basement')
    const file = new File(['img'], 'plan.jpg', { type: 'image/jpeg' })
    await attachPhoto(wrapper, file)

    expect(uploadAssetMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('plan.jpg')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(uploadAssetMock).toHaveBeenCalledWith(file)
    expect(createPlanMock).toHaveBeenCalledWith('Basement', { underlay_asset_id: 'asset-9' })
    expect(wrapper.emitted('created')).toEqual([[plan]])
  })

  it('rejects a non-image drop with an inline error and keeps the drop zone', async () => {
    const wrapper = mountCard()
    await attachPhoto(wrapper, new File(['x'], 'plan.pdf', { type: 'application/pdf' }))

    expect(wrapper.get('[role="alert"]').text()).toContain('Only JPEG and PNG')
    expect(wrapper.find('button[aria-label="Add an underlay photo"]').exists()).toBe(true)
  })

  it('removing the attached photo restores the drop zone and skips the upload', async () => {
    createPlanMock.mockResolvedValue(makePlan({ id: 'new' }))
    const wrapper = mountCard()
    await setName(wrapper, 'Basement')
    await attachPhoto(wrapper)
    await wrapper.get('button[aria-label="Remove photo"]').trigger('click')

    expect(wrapper.find('button[aria-label="Add an underlay photo"]').exists()).toBe(true)

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(uploadAssetMock).not.toHaveBeenCalled()
    expect(createPlanMock).toHaveBeenCalledWith('Basement', {})
  })

  it('surfaces an upload failure in the card and does not create the plan', async () => {
    uploadAssetMock.mockRejectedValue(new Error('Upload failed: too large'))
    const wrapper = mountCard()
    await setName(wrapper, 'Basement')
    await attachPhoto(wrapper)

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(createPlanMock).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('Upload failed: too large')
    expect(wrapper.emitted('created')).toBeUndefined()
  })

  it('surfaces a creation failure in the card', async () => {
    createPlanMock.mockRejectedValue(new Error('Name already taken'))
    const wrapper = mountCard()
    await setName(wrapper, 'Basement')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Name already taken')
    expect(wrapper.emitted('created')).toBeUndefined()
  })
})
