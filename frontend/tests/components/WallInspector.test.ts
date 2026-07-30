import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import WallInspector from '@/components/editor/WallInspector.vue'
import type { Wall } from '@/types/plan'
import { EXTERIOR_WALL_COLOR } from '@/utils/wallColors'
import { makeWall } from '../helpers/planFactory'

function mountInspector(wall: Wall = makeWall()): VueWrapper {
  return mount(WallInspector, {
    props: { wall, thicknessPresetsIn: [12, 4.5, 3.5] },
  })
}

function buttonByText(wrapper: VueWrapper, text: string): DOMWrapper<Element> {
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === text)
  if (!button) throw new Error(`button "${text}" not found`)
  return button
}

function lastEmitted<T>(wrapper: VueWrapper, event: string): T {
  const emissions = wrapper.emitted(event)
  if (!emissions || emissions.length === 0) throw new Error(`no "${event}" emitted`)
  return emissions[emissions.length - 1][0] as T
}

describe('WallInspector reference side (spec S1a)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('picking a side emits ONE update-wall with only the reference changed', async () => {
    const wall = makeWall()
    const wrapper = mountInspector(wall)

    await buttonByText(wrapper, 'Left face').trigger('click')

    expect(wrapper.emitted('update-wall')).toHaveLength(1)
    const updated = lastEmitted<Wall>(wrapper, 'update-wall')
    expect(updated.reference).toBe('left')
    expect(updated.vertices).toEqual(wall.vertices)
    expect(updated.thickness_in).toBe(wall.thickness_in)
    expect(updated.locked_segments).toEqual(wall.locked_segments)
  })

  it('re-picking the current side emits nothing', async () => {
    const wrapper = mountInspector(makeWall())

    await buttonByText(wrapper, 'Center').trigger('click')

    expect(wrapper.emitted('update-wall')).toBeUndefined()
  })

  it('hovering another side previews the would-be wall; mouse-out releases it', async () => {
    const wrapper = mountInspector(makeWall())

    await buttonByText(wrapper, 'Right face').trigger('mouseenter')
    expect(lastEmitted<Wall>(wrapper, 'preview-wall').reference).toBe('right')

    await wrapper.get('[aria-label="Reference side"]').trigger('mouseleave')
    expect(lastEmitted<Wall | null>(wrapper, 'preview-wall')).toBeNull()
  })

  it('hovering the current side previews nothing', async () => {
    const wrapper = mountInspector(makeWall())

    await buttonByText(wrapper, 'Center').trigger('mouseenter')

    expect(wrapper.emitted('preview-wall')).toBeUndefined()
  })

  it('committing a hovered side clears the preview before the update', async () => {
    const wrapper = mountInspector(makeWall())
    const button = buttonByText(wrapper, 'Left face')

    await button.trigger('mouseenter')
    await button.trigger('click')

    expect(lastEmitted<Wall | null>(wrapper, 'preview-wall')).toBeNull()
    expect(lastEmitted<Wall>(wrapper, 'update-wall').reference).toBe('left')
  })

  it('swap sides mirrors left to right as one undoable update', async () => {
    const wrapper = mountInspector(makeWall({ reference: 'left' }))

    await buttonByText(wrapper, 'Swap sides').trigger('click')

    expect(wrapper.emitted('update-wall')).toHaveLength(1)
    expect(lastEmitted<Wall>(wrapper, 'update-wall').reference).toBe('right')
  })

  it('swap sides mirrors right to left', async () => {
    const wrapper = mountInspector(makeWall({ reference: 'right' }))

    await buttonByText(wrapper, 'Swap sides').trigger('click')

    expect(lastEmitted<Wall>(wrapper, 'update-wall').reference).toBe('left')
  })

  it('swap sides is disabled for a centred reference — nothing to swap', () => {
    const wrapper = mountInspector(makeWall({ reference: 'center' }))

    expect(buttonByText(wrapper, 'Swap sides').attributes('disabled')).toBeDefined()
  })

  it('hovering swap previews the mirrored wall and mouse-out releases it', async () => {
    const wrapper = mountInspector(makeWall({ reference: 'right' }))
    const button = buttonByText(wrapper, 'Swap sides')

    await button.trigger('mouseenter')
    expect(lastEmitted<Wall>(wrapper, 'preview-wall').reference).toBe('left')

    await button.trigger('mouseleave')
    expect(lastEmitted<Wall | null>(wrapper, 'preview-wall')).toBeNull()
  })

  it('releases a live preview when the wall is replaced from outside (undo, edits)', async () => {
    const wall = makeWall({ reference: 'left' })
    const wrapper = mountInspector(wall)

    await buttonByText(wrapper, 'Swap sides').trigger('mouseenter')
    expect(lastEmitted<Wall>(wrapper, 'preview-wall').reference).toBe('right')

    await wrapper.setProps({ wall: { ...wall, reference: 'right' } })
    expect(lastEmitted<Wall | null>(wrapper, 'preview-wall')).toBeNull()
  })

  it('releases a live preview when the inspector unmounts', async () => {
    const wrapper = mountInspector(makeWall({ reference: 'left' }))

    await buttonByText(wrapper, 'Swap sides').trigger('mouseenter')
    wrapper.unmount()

    expect(lastEmitted<Wall | null>(wrapper, 'preview-wall')).toBeNull()
  })
})

describe('WallInspector colour (spec S1f)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('picking a swatch emits ONE update-wall with only the colour changed', async () => {
    const wall = makeWall()
    const wrapper = mountInspector(wall)

    await wrapper.get(`button[aria-label="Wall colour ${EXTERIOR_WALL_COLOR}"]`).trigger('click')

    expect(wrapper.emitted('update-wall')).toHaveLength(1)
    const updated = lastEmitted<Wall>(wrapper, 'update-wall')
    expect(updated.color).toBe(EXTERIOR_WALL_COLOR)
    expect(updated.thickness_in).toBe(wall.thickness_in)
    expect(updated.vertices).toEqual(wall.vertices)
  })

  it('"Default" hands the wall back to its role colour', async () => {
    const wrapper = mountInspector(makeWall({ color: '#b91c1c' }))

    await buttonByText(wrapper, 'Default').trigger('click')

    expect(lastEmitted<Wall>(wrapper, 'update-wall').color).toBeNull()
  })

  it('re-picking the colour the wall already carries emits nothing', async () => {
    const wrapper = mountInspector(makeWall())

    await buttonByText(wrapper, 'Default').trigger('click')

    expect(wrapper.emitted('update-wall')).toBeUndefined()
  })

  it('names the role whose default the wall follows, per its thickness', () => {
    expect(mountInspector(makeWall()).get('[aria-label="Wall colour"]').text()).toContain('Default')
    expect(mountInspector(makeWall({ thickness_in: 12 })).text()).toContain('exterior')
    expect(mountInspector(makeWall()).text()).toContain('interior')
  })
})
