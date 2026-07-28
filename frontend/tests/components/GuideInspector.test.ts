import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import GuideInspector from '@/components/editor/GuideInspector.vue'
import type { Guide } from '@/types/plan'

const SURFACE_GUIDE: Guide = {
  id: 'guide-surface',
  kind: 'surface',
  wall_id: 'wall-1',
  segment_index: 0,
  side: 'left',
  offset_in: 36,
}

const FREE_GUIDE: Guide = {
  id: 'guide-free',
  kind: 'free',
  origin: { x: 0, y: 50 },
  angle_deg: 0,
}

function mountInspector(guide: Guide): VueWrapper {
  return mount(GuideInspector, { props: { guide } })
}

describe('GuideInspector', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('names the anchoring and offers only the field that kind carries (spec S9)', () => {
    const surface = mountInspector(SURFACE_GUIDE)
    expect(surface.text()).toContain('Offset from wall')
    expect(surface.find('input[aria-label="Guide offset in feet and inches"]').exists()).toBe(true)
    expect(surface.find('input[aria-label="Guide angle in degrees"]').exists()).toBe(false)

    const free = mountInspector(FREE_GUIDE)
    expect(free.text()).toContain('Free line')
    expect(free.find('input[aria-label="Guide angle in degrees"]').exists()).toBe(true)
    expect(free.find('input[aria-label="Guide offset in feet and inches"]').exists()).toBe(false)

    const point = mountInspector({
      id: 'guide-point',
      kind: 'point',
      anchor: { wall_id: 'wall-1', end: 'end' },
      angle_deg: 45,
    })
    expect(point.text()).toContain('Through wall corner')
    expect(point.find('input[aria-label="Guide angle in degrees"]').exists()).toBe(true)
  })

  it('emits the whole guide with a re-typed offset in feet and inches', async () => {
    const wrapper = mountInspector(SURFACE_GUIDE)
    const input = wrapper.get<HTMLInputElement>(
      'input[aria-label="Guide offset in feet and inches"]',
    )
    expect(input.attributes('placeholder')).toBe(`3'0"`)

    await input.setValue(`4'6`)
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('update-guide')).toEqual([[{ ...SURFACE_GUIDE, offset_in: 54 }]])
    // The draft clears once committed, so the placeholder shows the stored value again.
    expect(input.element.value).toBe('')
  })

  it('flags an unparsable offset without emitting anything', async () => {
    const wrapper = mountInspector(SURFACE_GUIDE)
    const input = wrapper.get('input[aria-label="Guide offset in feet and inches"]')

    await input.setValue('over there')
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('update-guide')).toBeUndefined()
    expect(input.attributes('aria-invalid')).toBe('true')
  })

  it('emits the whole guide with a re-typed angle in degrees', async () => {
    const wrapper = mountInspector(FREE_GUIDE)
    const input = wrapper.get('input[aria-label="Guide angle in degrees"]')

    await input.setValue('22.5')
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('update-guide')).toEqual([[{ ...FREE_GUIDE, angle_deg: 22.5 }]])
  })

  it('asks the page to delete the selection from its Delete button', async () => {
    const wrapper = mountInspector(FREE_GUIDE)

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('delete-guide')).toHaveLength(1)
  })
})
