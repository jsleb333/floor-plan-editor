import { describe, expect, it } from 'vitest'

import { DEVICE_CATALOG } from '@/devices/catalog'
import { legendSize, planLegend, renderLegend } from '@/export/legend'
import type { LegendSection, LegendSize } from '@/export/legend'
import { EXTERIOR_WALL_COLOR, INTERIOR_WALL_COLOR } from '@/utils/wallColors'

import { makeCircuit, makeDevice, makeDocument, makeWall } from '../helpers/planFactory'

/** A plan with two circuits, three devices of two types and both wall roles. */
function makeLegendDocument() {
  return makeDocument({
    walls: [
      makeWall({ id: 'shell', thickness_in: 12, closed: true }),
      makeWall({ id: 'partition-a' }),
      makeWall({ id: 'partition-b' }),
    ],
    devices: [
      makeDevice({ id: 'o1', type: 'outlet' }),
      makeDevice({ id: 'o2', type: 'outlet' }),
      makeDevice({ id: 's1', type: 'switch' }),
    ],
    circuits: [
      makeCircuit({ id: 'c1', name: 'Prises sous-sol', color: '#2563eb' }),
      makeCircuit({ id: 'c2', name: 'Réseau', color: '#475569', kind: 'data' }),
    ],
  })
}

function sectionTitles(sections: readonly LegendSection[]): string[] {
  return sections.map((section) => section.title)
}

/** The panel size of `sections`, failing loudly when there is nothing to legend. */
function sizeOf(sections: readonly LegendSection[], language: 'en' | 'fr'): LegendSize {
  const size = legendSize(sections, language)
  if (!size) throw new Error('expected a legend size')
  return size
}

function labelsOf(sections: readonly LegendSection[], title: string): string[] {
  const section = sections.find((candidate) => candidate.title === title)
  if (!section) throw new Error(`no "${title}" section`)
  return section.entries.map((entry) => entry.label)
}

describe('planLegend', () => {
  it('legends the circuits, the device types placed and the wall colours drawn', () => {
    const sections = planLegend(makeLegendDocument(), { language: 'en' })

    expect(sectionTitles(sections)).toEqual(['Circuits', 'Devices', 'Walls'])
  })

  it('reads a power circuit as its breaker rating and a data circuit as its kind (spec C3)', () => {
    const sections = planLegend(makeLegendDocument(), { language: 'en' })

    expect(labelsOf(sections, 'Circuits')).toEqual([
      'Prises sous-sol — 15 A · 120 V',
      'Réseau — Data',
    ])
  })

  it('lists only the circuits the export includes', () => {
    const sections = planLegend(makeLegendDocument(), { language: 'en', circuitIds: ['c2'] })

    expect(labelsOf(sections, 'Circuits')).toEqual(['Réseau — Data'])
  })

  it('counts each device type once, in catalog order', () => {
    const sections = planLegend(makeLegendDocument(), { language: 'en' })
    const devices = sections.find((section) => section.title === 'Devices')?.entries ?? []

    expect(devices).toEqual([
      { kind: 'pictogram', type: 'outlet', label: 'Outlet', count: 2 },
      { kind: 'pictogram', type: 'switch', label: 'Switch', count: 1 },
    ])
  })

  it('collapses the walls to one row per role and colour, shell first', () => {
    const sections = planLegend(makeLegendDocument(), { language: 'en' })
    const walls = sections.find((section) => section.title === 'Walls')?.entries ?? []

    expect(walls).toEqual([
      { kind: 'swatch', color: EXTERIOR_WALL_COLOR, label: 'Exterior wall' },
      { kind: 'swatch', color: INTERIOR_WALL_COLOR, label: 'Interior wall' },
    ])
  })

  it('keeps a colour-overridden partition apart from the plain ones', () => {
    const document = makeDocument({
      walls: [makeWall({ id: 'a' }), makeWall({ id: 'b', color: '#b91c1c' })],
    })

    const walls = planLegend(document, { language: 'en' })[0].entries

    expect(walls).toHaveLength(2)
    expect(walls.map((entry) => (entry.kind === 'swatch' ? entry.color : ''))).toEqual([
      INTERIOR_WALL_COLOR,
      '#b91c1c',
    ])
  })

  it('says everything the editor chose in French, user text verbatim (spec X5)', () => {
    const sections = planLegend(makeLegendDocument(), { language: 'fr' })

    expect(sectionTitles(sections)).toEqual(['Circuits', 'Appareils', 'Murs'])
    expect(labelsOf(sections, 'Appareils')).toEqual([
      DEVICE_CATALOG.outlet.legendFr,
      DEVICE_CATALOG.switch.legendFr,
    ])
    expect(labelsOf(sections, 'Murs')).toEqual(['Mur extérieur', 'Mur intérieur'])
    expect(labelsOf(sections, 'Circuits')[1]).toBe('Réseau — Données')
  })

  it('has nothing to say about an empty plan', () => {
    expect(planLegend(makeDocument(), { language: 'en' })).toEqual([])
  })
})

describe('legendSize', () => {
  it('is null when there is nothing to legend, so no column is reserved', () => {
    expect(legendSize([], 'en')).toBeNull()
  })

  it('grows taller with every row and never narrower than the minimum', () => {
    const short = planLegend(makeDocument({ walls: [makeWall()] }), { language: 'en' })
    const full = planLegend(makeLegendDocument(), { language: 'en' })

    const shortSize = sizeOf(short, 'en')
    const fullSize = sizeOf(full, 'en')

    expect(fullSize.heightIn).toBeGreaterThan(shortSize.heightIn)
    expect(shortSize.widthIn).toBeGreaterThanOrEqual(132)
  })

  it('widens for a long circuit name rather than clipping it', () => {
    const long = planLegend(
      makeDocument({ circuits: [makeCircuit({ name: 'Éclairage extérieur et garage détaché' })] }),
      { language: 'fr' },
    )
    const short = planLegend(makeDocument({ circuits: [makeCircuit({ name: 'A' })] }), {
      language: 'fr',
    })

    expect(sizeOf(long, 'fr').widthIn).toBeGreaterThan(sizeOf(short, 'fr').widthIn)
  })
})

describe('renderLegend', () => {
  it('draws one translated group carrying the title, headings and rows', () => {
    const sections = planLegend(makeLegendDocument(), { language: 'fr' })
    const size = sizeOf(sections, 'fr')

    const svg = renderLegend(sections, size, 'fr', 300, -12)

    expect(svg.startsWith('<g id="legend" transform="translate(300 -12)">')).toBe(true)
    expect(svg).toContain('>Légende<')
    expect(svg).toContain('>Appareils<')
    expect(svg).toContain(`stroke="#2563eb"`)
    expect(svg).toContain(`fill="${EXTERIOR_WALL_COLOR}"`)
    expect(svg).toContain('Prise électrique  × 2')
  })

  it('escapes user text so a circuit named with markup cannot break the file', () => {
    const sections = planLegend(
      makeDocument({ circuits: [makeCircuit({ name: 'A & <b>B</b>' })] }),
      { language: 'en' },
    )
    const size = sizeOf(sections, 'en')

    const svg = renderLegend(sections, size, 'en', 0, 0)

    expect(svg).toContain('A &amp; &lt;b&gt;B&lt;/b&gt;')
    expect(svg).not.toContain('<b>')
  })
})
