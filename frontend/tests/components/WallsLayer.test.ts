import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import WallsLayer from '@/components/editor/WallsLayer.vue'
import { useEditorStore } from '@/stores/editor'
import { makeDocument, makeWall } from '../helpers/planFactory'

describe('WallsLayer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders one path per wall, skipping degenerate walls', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [
        makeWall({ id: 'a' }),
        makeWall({
          id: 'b',
          vertices: [
            { x: 0, y: 120 },
            { x: 240, y: 120 },
            { x: 240, y: 240 },
          ],
        }),
        makeWall({ id: 'degenerate', vertices: [{ x: 0, y: 0 }] }),
      ],
    })

    const wrapper = mount(WallsLayer, { props: { hairline: 0.5 } })
    expect(wrapper.findAll('path')).toHaveLength(2)
  })

  it('renders a closed loop as a single two-ring path with evenodd fill', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [
        makeWall({
          id: 'loop',
          closed: true,
          vertices: [
            { x: 0, y: 0 },
            { x: 240, y: 0 },
            { x: 240, y: 240 },
            { x: 0, y: 240 },
          ],
        }),
      ],
    })

    const wrapper = mount(WallsLayer, { props: { hairline: 0.5 } })
    const paths = wrapper.findAll('path')
    expect(paths).toHaveLength(1)
    const d = paths[0].attributes('d') ?? ''
    expect(d.match(/M /g)).toHaveLength(2)
    expect(paths[0].attributes('fill-rule')).toBe('evenodd')
  })

  it('renders nothing for an empty document', () => {
    const wrapper = mount(WallsLayer, { props: { hairline: 0.5 } })
    expect(wrapper.findAll('path')).toHaveLength(0)
  })

  it('renders selected walls with the accent state', () => {
    const store = useEditorStore()
    store.document = makeDocument({ walls: [makeWall({ id: 'a' }), makeWall({ id: 'b' })] })
    store.select([{ kind: 'wall', id: 'a' }])

    const wrapper = mount(WallsLayer, { props: { hairline: 0.5 } })
    const paths = wrapper.findAll('path')
    expect(paths[0].classes()).toContain('stroke-accent-strong')
    expect(paths[1].classes()).toContain('fill-wall')
  })

  it('trims a T-junction endpoint to the host face at render time', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [
        makeWall({
          id: 'host',
          vertices: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
          ],
          thickness_in: 12,
        }),
        makeWall({
          id: 'butting',
          vertices: [
            { x: 50, y: 40 },
            { x: 50, y: 0 },
          ],
          junctions: [{ end: 'end', host_wall_id: 'host', segment_index: 0, t: 50 }],
        }),
      ],
    })

    const wrapper = mount(WallsLayer, { props: { hairline: 0.5 } })
    const buttingD = wrapper.findAll('path')[1].attributes('d') ?? ''
    const coordinates = buttingD.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
    const yValues = coordinates.filter((_, index) => index % 2 === 1)
    // The stored endpoint sits on the host reference line (y=0); the rendered
    // outline stops at the host's near face (y=6).
    expect(Math.min(...yValues)).toBe(6)
  })
})
