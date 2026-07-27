import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import OpeningsLayer from '@/components/editor/OpeningsLayer.vue'
import { buildPlanSvg } from '@/export/svgExport'
import { useEditorStore } from '@/stores/editor'
import type { DoorStyle } from '@/types/plan'
import { makeDocument, makeOpening, makeWall } from '../helpers/planFactory'

describe('OpeningsLayer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders an interruption, jambs and the swing symbol for a door', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [makeWall()],
      openings: [makeOpening({ id: 'door-1' })],
    })

    const wrapper = mount(OpeningsLayer, { props: { hairline: 0.5 } })
    expect(wrapper.findAll('polygon')).toHaveLength(1)
    expect(wrapper.findAll('line')).toHaveLength(2)
    const door = wrapper.find('path')
    expect(door.exists()).toBe(true)
    expect(door.attributes('d')).toContain('A 32 32')
  })

  it('renders one path per leaf for a double door and two bypassing panels for a slider', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [makeWall()],
      openings: [
        makeOpening({ id: 'double-1', style: 'double' }),
        makeOpening({ id: 'slide-1', style: 'sliding' }),
      ],
    })

    const wrapper = mount(OpeningsLayer, { props: { hairline: 0.5 } })
    const paths = wrapper.findAll('path').map((path) => path.attributes('d'))
    expect(paths).toEqual([
      'M 44 0 L 44 -16 A 16 16 0 0 1 60 0',
      'M 76 0 L 76 -16 A 16 16 0 0 0 60 0',
      'M 44 -0.875 L 60 -0.875',
      'M 60 0.875 L 76 0.875',
    ])
  })

  it('dashes only the pocket cavity stroke of a pocket door', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [makeWall()],
      openings: [makeOpening({ id: 'pocket-1', style: 'pocket' })],
    })

    const wrapper = mount(OpeningsLayer, { props: { hairline: 0.5 } })
    const paths = wrapper.findAll('path')
    expect(paths.map((path) => path.attributes('d'))).toEqual(['M 44 0 L 76 0', 'M 44 0 L 12 0'])
    expect(paths[0].attributes('stroke-dasharray')).toBeUndefined()
    expect(paths[1].attributes('stroke-dasharray')).toBe('3 2')
  })

  it('renders a bifold as one folded two-segment path', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [makeWall()],
      openings: [makeOpening({ id: 'bifold-1', style: 'bifold' })],
    })

    const wrapper = mount(OpeningsLayer, { props: { hairline: 0.5 } })
    expect(wrapper.findAll('path')).toHaveLength(1)
    expect(wrapper.find('path').attributes('d')).toBe('M 44 0 L 52 -8 L 60 0')
  })

  it('renders a double bifold as two folded paths meeting at the opening centre', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [makeWall()],
      openings: [makeOpening({ id: 'double-bifold-1', style: 'double_bifold', width_in: 60 })],
    })

    const wrapper = mount(OpeningsLayer, { props: { hairline: 0.5 } })
    expect(wrapper.findAll('path').map((path) => path.attributes('d'))).toEqual([
      'M 30 0 L 45 -15 L 60 0',
      'M 90 0 L 75 -15 L 60 0',
    ])
  })

  it('renders glazing lines instead of a swing symbol for a window', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [makeWall()],
      openings: [makeOpening({ id: 'win-1', kind: 'window' })],
    })

    const wrapper = mount(OpeningsLayer, { props: { hairline: 0.5 } })
    expect(wrapper.find('path').exists()).toBe(false)
    // Two jambs + two glazing lines.
    expect(wrapper.findAll('line')).toHaveLength(4)
  })

  it.each(['swing', 'double', 'sliding', 'bifold', 'double_bifold', 'pocket'] as const)(
    'draws a %s door with exactly the paths the SVG export writes',
    (style: DoorStyle) => {
      const store = useEditorStore()
      const document = makeDocument({
        walls: [makeWall()],
        openings: [makeOpening({ id: `door-${style}`, style })],
      })
      store.document = document

      const wrapper = mount(OpeningsLayer, { props: { hairline: 0.5 } })
      const canvasPaths = wrapper.findAll('path').map((path) => path.attributes('d'))
      // The export rounds coordinates to 4 decimals; on this axis-aligned wall
      // every coordinate is exact, so the strings must match character for character.
      const structure = buildPlanSvg(document).match(/<g id="structure">(.*?)<\/g>/)?.[1] ?? ''
      const exportedPaths = [...structure.matchAll(/<path d="([^"]*)" fill="none"/g)].map(
        (match) => match[1],
      )

      expect(canvasPaths.length).toBeGreaterThan(0)
      expect(exportedPaths).toEqual(canvasPaths)
    },
  )

  it('skips openings whose host wall is missing and applies the selected accent', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [makeWall()],
      openings: [makeOpening({ id: 'door-1' }), makeOpening({ id: 'orphan', wall_id: 'ghost' })],
    })
    store.select([{ kind: 'opening', id: 'door-1' }])

    const wrapper = mount(OpeningsLayer, { props: { hairline: 0.5 } })
    expect(wrapper.findAll('polygon')).toHaveLength(1)
    expect(wrapper.find('path').classes()).toContain('stroke-accent-strong')
  })
})
