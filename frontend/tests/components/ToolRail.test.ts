import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ToolRail from '@/components/editor/ToolRail.vue'
import { toolsForMode } from '@/components/editor/tools'
import type { ToolId } from '@/components/editor/tools'

const STRUCTURE_TOOLS = toolsForMode('structure')

function mountRail(activeTool: ToolId): VueWrapper {
  return mount(ToolRail, { props: { tools: STRUCTURE_TOOLS, activeTool } })
}

describe('ToolRail', () => {
  it('offers one segment per tool, in rail order', () => {
    const wrapper = mountRail('select')

    expect(wrapper.findAll('button').map((button) => button.attributes('title'))).toEqual(
      STRUCTURE_TOOLS.map((tool) => `${tool.name} (${tool.shortcut.toUpperCase()})`),
    )
  })

  it('marks only the active tool as pressed', () => {
    const wrapper = mountRail('wall')

    const pressed = wrapper
      .findAll('button')
      .filter((button) => button.attributes('aria-pressed') === 'true')

    expect(pressed.map((button) => button.attributes('title'))).toEqual(['Wall (W)'])
  })

  it('slides the highlight to the active segment', () => {
    const first = mountRail(STRUCTURE_TOOLS[0].id)
    const third = mountRail(STRUCTURE_TOOLS[2].id)

    expect(first.find('span[aria-hidden="true"]').attributes('style')).toContain('translateY(0%)')
    expect(third.find('span[aria-hidden="true"]').attributes('style')).toContain('translateY(200%)')
  })

  it('hides the highlight when the armed tool is not on the rail', () => {
    const wrapper = mount(ToolRail, {
      props: { tools: STRUCTURE_TOOLS, activeTool: 'wire' },
    })

    expect(wrapper.find('span[aria-hidden="true"]').attributes('style')).toContain('display: none')
  })

  it('emits select with the picked tool', async () => {
    const wrapper = mountRail('select')

    const wall = wrapper
      .findAll('button')
      .find((button) => button.attributes('title') === 'Wall (W)')
    await wall?.trigger('click')

    expect(wrapper.emitted('select')).toEqual([['wall']])
  })
})
