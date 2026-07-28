import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TapeToolOverlay from '@/components/editor/TapeToolOverlay.vue'
import type { TapeToolPreview } from '@/composables/useTapeTool'

/** A free-mode preview: the tape has a start, a snapped cursor and both readings. */
const FREE_PREVIEW: TapeToolPreview = {
  mode: 'free',
  start: { x: 0, y: 0 },
  point: { x: 120, y: 0 },
  line: { point: { x: 0, y: 0 }, dir: { x: 1, y: 0 } },
  chip: { at: { x: 120, y: 0 }, text: `10'0"`, secondary: '0°' },
  measurement: `10'0"`,
  marker: { kind: 'endpoint', point: { x: 120, y: 0 } },
}

describe('TapeToolOverlay', () => {
  it('draws the pending infinite line, the start dot and both chip readings', () => {
    const wrapper = mount(TapeToolOverlay, { props: { preview: FREE_PREVIEW, hairline: 0.5 } })

    const line = wrapper.get('line')
    expect(Number(line.attributes('x1'))).toBeLessThan(-10000)
    expect(Number(line.attributes('x2'))).toBeGreaterThan(10000)
    expect(wrapper.findAll('circle')).toHaveLength(1)
    const text = wrapper.get('text')
    expect(text.text()).toContain(`10'0"`)
    expect(text.get('tspan').text()).toBe('0°')
  })

  it('marks a captured endpoint with a square and a guide hit with a circle (spec E6)', () => {
    const endpoint = mount(TapeToolOverlay, { props: { preview: FREE_PREVIEW, hairline: 0.5 } })
    expect(endpoint.findAll('rect')).toHaveLength(1)

    const onGuide = mount(TapeToolOverlay, {
      props: {
        preview: {
          ...FREE_PREVIEW,
          marker: { kind: 'guide', point: { x: 120, y: 0 } },
        },
        hairline: 0.5,
      },
    })
    expect(onGuide.findAll('rect')).toHaveLength(0)
    // The start dot plus the marker circle.
    expect(onGuide.findAll('circle')).toHaveLength(2)
  })

  it('shows nothing but the snapped cursor before the first click', () => {
    const wrapper = mount(TapeToolOverlay, {
      props: {
        preview: {
          mode: 'idle',
          start: null,
          point: { x: 10, y: 10 },
          line: null,
          chip: null,
          measurement: null,
          marker: null,
        },
        hairline: 0.5,
      },
    })

    expect(wrapper.findAll('line')).toHaveLength(0)
    expect(wrapper.findAll('text')).toHaveLength(0)
    expect(wrapper.findAll('circle')).toHaveLength(1)
  })
})
