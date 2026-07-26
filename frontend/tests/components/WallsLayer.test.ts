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

  it('strokes the face tints and direction markers on a selected wall only (spec S1a)', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [
        makeWall({ id: 'a' }),
        makeWall({
          id: 'b',
          vertices: [
            { x: 0, y: 100 },
            { x: 120, y: 100 },
          ],
        }),
      ],
    })
    store.select([{ kind: 'wall', id: 'a' }])

    const wrapper = mount(WallsLayer, { props: { hairline: 0.5 } })
    const identities = wrapper.findAll('[aria-label="Wall face identity"]')
    expect(identities).toHaveLength(1)

    const identity = identities[0]
    const left = identity.findAll('path').find((p) => p.classes().includes('stroke-face-left/70'))
    const right = identity.findAll('path').find((p) => p.classes().includes('stroke-face-right/70'))
    expect(left?.exists()).toBe(true)
    expect(right?.exists()).toBe(true)
    // Drawing east: the walker's-left face is up-screen (y = -1.75 for a
    // centred 3.5" wall), the right face down-screen (y = +1.75).
    expect(left?.attributes('d')).toContain('-1.75')
    expect(right?.attributes('d')).toContain('1.75')
    // Start circle at the first reference vertex, arrowhead at the end.
    const start = identity.find('circle')
    expect(start.attributes('cx')).toBe('0')
    expect(start.attributes('cy')).toBe('0')
    const arrow = identity.findAll('path').find((p) => p.classes().includes('fill-accent-strong'))
    expect(arrow?.attributes('transform')).toContain('translate(120 0)')
  })

  it('follows the drawing direction, not the reference mode, for the face tints', () => {
    const store = useEditorStore()
    // Drawn WEST: the walker's left face is down-screen (+y).
    store.document = makeDocument({
      walls: [
        makeWall({
          id: 'a',
          reference: 'left',
          thickness_in: 6,
          vertices: [
            { x: 120, y: 0 },
            { x: 0, y: 0 },
          ],
        }),
      ],
    })
    store.select([{ kind: 'wall', id: 'a' }])

    const wrapper = mount(WallsLayer, { props: { hairline: 0.5 } })
    const identity = wrapper.get('[aria-label="Wall face identity"]')
    const left = identity.findAll('path').find((p) => p.classes().includes('stroke-face-left/70'))
    const right = identity.findAll('path').find((p) => p.classes().includes('stroke-face-right/70'))
    // Reference 'left': the reference line IS the left face (y = 0); the body
    // grows toward the walker's right, up-screen here (y = -6).
    expect(left?.attributes('d')).toBe('M 120 0 L 0 0')
    expect(right?.attributes('d')).toBe('M 120 -6 L 0 -6')
  })

  it('dims the previewed wall and ghosts the would-be geometry (spec S1a)', () => {
    const store = useEditorStore()
    const wall = makeWall({ id: 'a', reference: 'left', thickness_in: 6 })
    store.document = makeDocument({ walls: [wall] })
    store.select([{ kind: 'wall', id: 'a' }])

    const wrapper = mount(WallsLayer, {
      props: { hairline: 0.5, previewWall: { ...wall, reference: 'right' } },
    })

    const body = wrapper.findAll('path')[0]
    expect(body.classes()).toContain('opacity-40')

    const ghost = wrapper.get('[aria-label="Reference change preview"]')
    const coordinates = (ghost.attributes('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
    const yValues = coordinates.filter((_, index) => index % 2 === 1)
    // Stored left-reference body spans y 0..6; the right-reference ghost is
    // mirrored across the reference line to y -6..0.
    expect(Math.min(...yValues)).toBe(-6)
    expect(Math.max(...yValues)).toBe(0)
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
