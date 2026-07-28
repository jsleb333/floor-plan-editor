import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import GuidesLayer from '@/components/editor/GuidesLayer.vue'
import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type { Guide } from '@/types/plan'

import { makeDocument, makeWall } from '../helpers/planFactory'

/** A free horizontal guide 50" below the origin. */
const FREE_GUIDE: Guide = {
  id: 'guide-free',
  kind: 'free',
  origin: { x: 0, y: 50 },
  angle_deg: 0,
}

/** A guide 36" off the default wall's left surface — anchored, so it resolves from the wall. */
const SURFACE_GUIDE: Guide = {
  id: 'guide-surface',
  kind: 'surface',
  wall_id: 'wall-1',
  segment_index: 0,
  side: 'left',
  offset_in: 36,
}

/** A guide anchored to a wall that is not in the document: it resolves to nothing. */
const ORPHAN_GUIDE: Guide = {
  id: 'guide-orphan',
  kind: 'surface',
  wall_id: 'gone',
  segment_index: 0,
  side: 'left',
  offset_in: 12,
}

describe('GuidesLayer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('draws one long segment per resolvable guide, skipping the orphans', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [makeWall()],
      guides: [FREE_GUIDE, SURFACE_GUIDE, ORPHAN_GUIDE],
    })

    const wrapper = mount(GuidesLayer, { props: { hairline: 0.5 } })

    const lines = wrapper.findAll('line')
    expect(lines).toHaveLength(2)
    // An infinite line is drawn as a segment reaching far past any plan, dashed
    // in the S9 long-short rhythm so it never reads as an alignment guide.
    const free = lines[0]
    expect(Number(free.attributes('x1'))).toBeLessThan(-10000)
    expect(Number(free.attributes('x2'))).toBeGreaterThan(10000)
    expect(free.attributes('y1')).toBe('50')
    expect(free.attributes('y2')).toBe('50')
    expect(free.attributes('stroke-dasharray')?.split(' ')).toHaveLength(4)
    // The anchored guide is measured from the wall's left surface (y = -1.75).
    expect(Number(lines[1].attributes('y1'))).toBeCloseTo(-37.75)
  })

  it('renders nothing while the layer toggle is off (spec S9)', () => {
    const store = useEditorStore()
    store.document = makeDocument({ guides: [FREE_GUIDE] })
    useLayersStore().guidesVisible = false

    const wrapper = mount(GuidesLayer, { props: { hairline: 0.5 } })

    expect(wrapper.find('[aria-label="Custom guides"]').exists()).toBe(false)
    expect(wrapper.findAll('line')).toHaveLength(0)
  })

  it('strokes a selected guide with the accent, like a selected wall', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      guides: [FREE_GUIDE, { ...FREE_GUIDE, id: 'guide-other', angle_deg: 90 }],
    })
    store.select([{ kind: 'guide', id: 'guide-free' }])

    const wrapper = mount(GuidesLayer, { props: { hairline: 0.5 } })

    const accented = wrapper.findAll('line.stroke-accent-strong')
    expect(accented).toHaveLength(1)
    expect(wrapper.findAll('line.stroke-ink-faint')).toHaveLength(1)
    expect(Number(accented[0].attributes('stroke-width'))).toBeGreaterThan(0.5)
  })
})
