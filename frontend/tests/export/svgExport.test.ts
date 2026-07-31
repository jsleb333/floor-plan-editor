import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEVICE_STROKE_IN,
  EXPORT_INK,
  EXPORT_INK_MUTED,
  GUIDE_DASH_IN,
  GUIDE_STROKE_IN,
} from '@/export/exportTheme'
import { legendSize, planLegend } from '@/export/legend'
import type { LegendSize } from '@/export/legend'
import {
  buildPlanSvg,
  embedUnderlay,
  planViewBox,
  slugify,
  type UnderlayEmbed,
} from '@/export/svgExport'
import type { DoorStyle, Guide, PlanDocument, Point } from '@/types/plan'
import { DOOR_DASH_IN, deviceWorldPlacement, doorFigure, wallOutline } from '@/utils/geometry'
import { doorStrokeToPath, ringsToPath } from '@/utils/svgPath'
import { EXTERIOR_WALL_COLOR, INTERIOR_WALL_COLOR } from '@/utils/wallColors'

import {
  makeCircuit,
  makeDevice,
  makeDimension,
  makeDocument,
  makeLabel,
  makeOpening,
  makeStairs,
  makeUnderlay,
  makeWall,
  makeWire,
} from '../helpers/planFactory'

vi.mock('@/persistence/assets', () => ({
  uploadAsset: vi.fn(),
  resolveAssetUrl: vi.fn(),
  readAssetBlob: vi.fn(),
}))

import { readAssetBlob } from '@/persistence/assets'

const readAssetBlobMock = vi.mocked(readAssetBlob)

/** The default circuit colour of `makeCircuit`, and a contrasting second one. */
const RED = '#dc2626'
const BLUE = '#2563eb'
/** Where the free-standing panel sits in these documents. */
const PANEL: Point = { x: 0, y: -20 }

/** The legend panel size of a document, failing loudly when it has nothing to legend. */
function legendSizeOf(document: PlanDocument, language: 'en' | 'fr' = 'en'): LegendSize {
  const size = legendSize(planLegend(document, { language }), language)
  if (!size) throw new Error('expected a legend size')
  return size
}

/** A document carrying one of every element, all resolvable, for whole-file assertions. */
function makeRichDocument(overrides: Partial<PlanDocument> = {}): PlanDocument {
  const wall = makeWall()
  const outlet = makeDevice({ id: 'device-1' })
  const panel = makeDevice({
    id: 'panel',
    type: 'panel',
    attachment: null,
    position: { x: 0, y: -20 },
  })
  return makeDocument({
    walls: [wall],
    openings: [makeOpening()],
    stairs: [makeStairs()],
    labels: [makeLabel()],
    dimensions: [makeDimension()],
    devices: [outlet, panel],
    circuits: [makeCircuit()],
    wires: [makeWire()],
    ...overrides,
  })
}

/** A free horizontal guide whose stored origin lies a mile east of the plan. */
const FAR_GUIDE: Guide = {
  id: 'guide-far',
  kind: 'free',
  origin: { x: 100000, y: 30 },
  angle_deg: 0,
}
/** A guide anchored 12" off the default wall's left surface. */
const WALL_GUIDE: Guide = {
  id: 'guide-wall',
  kind: 'surface',
  wall_id: 'wall-1',
  segment_index: 0,
  side: 'left',
  offset_in: 12,
}
/** A vertical guide a mile east: it never crosses the page. */
const OFF_PAGE_GUIDE: Guide = {
  id: 'guide-off',
  kind: 'free',
  origin: { x: 100000, y: 0 },
  angle_deg: 90,
}

/** The contents of the export's guides group; throws when it has none. */
function guidesGroup(svg: string): string {
  const match = svg.match(/<g id="guides">(.*?)<\/g>/)
  if (!match) throw new Error('the export has no guides group')
  return match[1]
}

describe('slugify', () => {
  it('kebab-cases circuit names and falls back for empty results', () => {
    expect(slugify('Prises sous-sol')).toBe('prises-sous-sol')
    expect(slugify('Circuit 1')).toBe('circuit-1')
    expect(slugify('   ')).toBe('circuit')
  })
})

describe('planViewBox', () => {
  it('is the content bounds grown by a 12" margin, in real inches', () => {
    const document = makeDocument({ walls: [makeWall()] })
    // A 10' x 3.5" centred wall spans x[0,120], y[-1.75,1.75].
    expect(planViewBox(document)).toEqual({
      minX: -12,
      minY: -13.75,
      width: 144,
      height: 27.5,
    })
  })

  it('reserves the legend column and, if taller, the legend height (spec X5)', () => {
    const document = makeRichDocument()
    const plain = planViewBox(document)
    const withLegend = planViewBox(document, { includeLegend: true })
    const size = legendSizeOf(document)

    expect(withLegend.minX).toBe(plain.minX)
    expect(withLegend.minY).toBe(plain.minY)
    expect(withLegend.width).toBe(plain.width + size.widthIn + 12)
    expect(withLegend.height).toBe(Math.max(plain.height, size.heightIn + 24))
  })

  it('reserves nothing for a legend a plan has nothing to fill (spec X5)', () => {
    const empty = makeDocument()

    expect(planViewBox(empty, { includeLegend: true })).toEqual(planViewBox(empty))
  })
})

describe('buildPlanSvg', () => {
  it('emits the named layer groups and a real-inch viewBox matching planViewBox', () => {
    const document = makeRichDocument()
    const svg = buildPlanSvg(document)
    const viewBox = planViewBox(document)

    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('<g id="structure">')
    expect(svg).toContain('<g id="devices">')
    expect(svg).toContain('<g id="annotations">')
    expect(svg).toContain(
      `viewBox="${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}"`,
    )
    expect(svg).toContain(`width="${viewBox.width}in"`)
    expect(svg).toContain(`height="${viewBox.height}in"`)
  })

  it('serialises a wall with the exact shared ringsToPath(wallOutline(...)) geometry', () => {
    const wall = makeWall()
    const svg = buildPlanSvg(makeDocument({ walls: [wall] }))
    const expected = ringsToPath(
      wallOutline({
        vertices: wall.vertices,
        thicknessIn: wall.thickness_in,
        reference: wall.reference,
        closed: wall.closed,
      }),
    )
    expect(expected).not.toBe('')
    expect(svg).toContain(`d="${expected}"`)
  })

  it('fills and outlines each wall in its own colour, and its openings with it (spec S1f)', () => {
    const document = makeDocument({
      walls: [
        makeWall({ id: 'shell', thickness_in: 12, closed: false }),
        makeWall({
          id: 'partition',
          vertices: [
            { x: 0, y: 60 },
            { x: 120, y: 60 },
          ],
        }),
      ],
      openings: [makeOpening({ wall_id: 'partition' })],
    })
    const svg = buildPlanSvg(document)

    // Body fill and merged-boundary outline are separate paths, one colour each.
    expect(svg).toContain(`fill="${EXTERIOR_WALL_COLOR}" fill-rule="evenodd" stroke="none"`)
    expect(svg).toContain(`fill="none" stroke="${EXTERIOR_WALL_COLOR}"`)
    expect(svg).toContain(`fill="${INTERIOR_WALL_COLOR}" fill-rule="evenodd" stroke="none"`)
    expect(svg).toContain(`fill="none" stroke="${INTERIOR_WALL_COLOR}"`)
    // The jambs and the door leaf of an opening read in their host wall's colour.
    expect(svg).toContain(
      `<line x1="44" y1="58.25" x2="44" y2="61.75" stroke="${INTERIOR_WALL_COLOR}"`,
    )
  })

  it('honours a wall colour override over the role default (spec S1f)', () => {
    const svg = buildPlanSvg(
      makeDocument({ walls: [makeWall({ thickness_in: 12, color: '#b91c1c' })] }),
    )

    expect(svg).toContain('fill="#b91c1c" fill-rule="evenodd" stroke="none"')
    expect(svg).toContain('fill="none" stroke="#b91c1c"')
    expect(svg).not.toContain(EXTERIOR_WALL_COLOR)
  })

  it('serialises a footprint device as its true-size rectangle plus the inscribed glyph', () => {
    const document = makeDocument({
      walls: [makeWall()],
      devices: [makeDevice({ id: 'bb', type: 'baseboard_heater', length_in: 36 })],
    })
    const placement = deviceWorldPlacement(document.devices[0], document.walls)
    if (!placement?.footprintRect) throw new Error('expected a footprint rectangle')

    const svg = buildPlanSvg(document)
    const points = placement.footprintRect.map((p) => `${p.x},${p.y}`).join(' ')
    expect(svg).toContain(`<polygon points="${points}"`)
    // The glyph draws at the rectangle's centre, exactly as on the canvas —
    // a footprint device's glyph offset is always 0.
    expect(placement.glyphOffsetIn).toBe(0)
    expect(svg).toContain(
      `translate(${placement.glyphAnchor.x} ${placement.glyphAnchor.y}) rotate(0)`,
    )
  })

  it("composes a symbolic device's glyph anchor and baseline offset exactly like the canvas (spec D1/D4)", () => {
    const document = makeDocument({ walls: [makeWall()], devices: [makeDevice({ id: 'd1' })] })
    const placement = deviceWorldPlacement(document.devices[0], document.walls)
    if (!placement) throw new Error('expected a placement')

    // The default outlet's circle used to reach into the wall (it had no
    // baseline shift at all); it now carries a real offset, applied inside
    // the transform exactly like `DevicesLayer.vue` — the export is fixed at
    // scale 1, but composes the same `translate/rotate/scale/translate` chain.
    expect(placement.glyphOffsetIn).toBeCloseTo(3.6, 9)
    const svg = buildPlanSvg(document)
    // The export rounds coordinates to 4 decimals, so a pure `9.6 - 6` float
    // (3.5999999999999996) prints as the clean 3.6 it should be.
    const offsetIn = Number((-placement.glyphOffsetIn).toFixed(4))
    expect(svg).toContain(
      `<g transform="translate(${placement.glyphAnchor.x} ${placement.glyphAnchor.y}) ` +
        `rotate(${placement.angleDeg}) scale(1) translate(0 ${offsetIn}) translate(-6 -6)">`,
    )
  })

  it('grows the viewBox to cover a footprint device and the glyph inscribed in it', () => {
    const heater = makeDevice({
      id: 'wh',
      type: 'water_heater',
      attachment: null,
      position: { x: 0, y: 0 },
    })
    // The 22" rectangle dominates the 12" glyph box, so the content is 22" wide.
    expect(planViewBox(makeDocument({ devices: [heater] }))).toEqual({
      minX: -23,
      minY: -23,
      width: 46,
      height: 46,
    })
    // A shallow panel (14" x 4") is narrower than its own glyph across the wall,
    // so the glyph box, not the rectangle, sets the vertical extent.
    const panel = makeDevice({ id: 'p', type: 'panel', attachment: null, position: { x: 0, y: 0 } })
    expect(planViewBox(makeDocument({ devices: [panel] }))).toEqual({
      minX: -19,
      minY: -18,
      width: 38,
      height: 36,
    })
  })

  it('paints a device on a circuit in the circuit colour, footprint rectangle and glyph alike', () => {
    const heater = makeDevice({ id: 'bb', type: 'baseboard_heater', length_in: 36 })
    const document = makeRichDocument({
      devices: [
        heater,
        makeDevice({ id: 'panel', type: 'panel', attachment: null, position: PANEL }),
      ],
      wires: [makeWire({ id: 'w1', from_device_id: 'panel', to_device_id: 'bb' })],
    })
    const placement = deviceWorldPlacement(heater, document.walls)
    if (!placement?.footprintRect) throw new Error('expected a footprint rectangle')

    const svg = buildPlanSvg(document)
    const points = placement.footprintRect.map((p) => `${p.x},${p.y}`).join(' ')
    expect(svg).toContain(`<polygon points="${points}" fill="none" stroke="${RED}"`)
    // The heater's inscribed glyph strokes in the same colour, not in ink.
    expect(svg).toContain(`<rect x="1" y="4.6" width="10" height="2.8" fill="none" stroke="${RED}"`)
  })

  it('keeps a source in ink and leaves a device on no circuit in ink', () => {
    const svg = buildPlanSvg(makeRichDocument({ wires: [] }))
    // The panel's own 14" x 4" footprint rectangle, and the outlet's glyph circle.
    expect(svg).toContain(`stroke="${EXPORT_INK}" stroke-width="${1.2 * DEVICE_STROKE_IN}"`)
    expect(svg).toContain(`<circle cx="6" cy="6" r="3.6" fill="none" stroke="${EXPORT_INK}"`)
    expect(svg).not.toContain(`<circle cx="6" cy="6" r="3.6" fill="none" stroke="${RED}"`)
  })

  it('paints a multi-circuit device with the FIRST circuit in document order (spec C3)', () => {
    const power = makeCircuit({ id: 'circuit-1', color: RED })
    const data = makeCircuit({ id: 'circuit-2', name: 'Data', kind: 'data', color: BLUE })
    const document = makeRichDocument({
      devices: [
        makeDevice({ id: 'jack', type: 'network_jack' }),
        makeDevice({ id: 'panel', type: 'panel', attachment: null, position: PANEL }),
      ],
      circuits: [power, data],
      wires: [
        makeWire({
          id: 'w1',
          circuit_id: 'circuit-2',
          from_device_id: 'panel',
          to_device_id: 'jack',
        }),
        makeWire({
          id: 'w2',
          circuit_id: 'circuit-1',
          from_device_id: 'panel',
          to_device_id: 'jack',
        }),
      ],
    })

    expect(buildPlanSvg(document)).toContain(`stroke="${RED}" stroke-width="${DEVICE_STROKE_IN}"`)
    expect(buildPlanSvg({ ...document, circuits: [data, power] })).toContain(
      `stroke="${BLUE}" stroke-width="${DEVICE_STROKE_IN}"`,
    )
  })

  it('colours devices independently of the circuitIds wire filter, exactly like the canvas', () => {
    const document = makeRichDocument({
      devices: [
        makeDevice({ id: 'device-1' }),
        makeDevice({ id: 'panel', type: 'panel', attachment: null, position: PANEL }),
      ],
      wires: [makeWire({ id: 'w1', from_device_id: 'panel', to_device_id: 'device-1' })],
    })

    const svg = buildPlanSvg(document, { circuitIds: [] })
    expect(svg).not.toContain('data-circuit="Circuit 1"')
    expect(svg).toContain(`<circle cx="6" cy="6" r="3.6" fill="none" stroke="${RED}"`)
  })

  it('emits one slugged, data-attributed group per circuit carrying its wire in the circuit colour', () => {
    const svg = buildPlanSvg(makeRichDocument())
    expect(svg).toContain('<g id="circuit-circuit-1" data-circuit="Circuit 1">')
    expect(svg).toContain('stroke="#dc2626"')
  })

  it('omits circuits filtered out by circuitIds', () => {
    const document = makeRichDocument({
      circuits: [makeCircuit({ id: 'circuit-1' }), makeCircuit({ id: 'circuit-2', name: 'Other' })],
    })
    const svg = buildPlanSvg(document, { circuitIds: ['circuit-2'] })
    expect(svg).not.toContain('data-circuit="Circuit 1"')
  })

  it.each(['swing', 'double', 'sliding', 'bifold', 'double_bifold', 'pocket'] as const)(
    'serialises a %s door from the shared doorFigure strokes',
    (style) => {
      const wall = makeWall()
      const opening = makeOpening({ style })
      const svg = buildPlanSvg(makeDocument({ walls: [wall], openings: [opening] }))
      const strokes = doorFigure(wall, opening)?.strokes ?? []

      expect(strokes.length).toBeGreaterThan(0)
      for (const stroke of strokes) {
        expect(svg).toContain(`<path d="${doorStrokeToPath(stroke)}"`)
      }
    },
  )

  it('dashes the pocket cavity, and only it, with the shared world-inch pattern', () => {
    const document = makeDocument({
      walls: [makeWall()],
      openings: [makeOpening({ style: 'pocket' })],
    })
    const svg = buildPlanSvg(document)

    expect(svg).toContain(`<path d="M 44 0 L 12 0" fill="none" stroke="${INTERIOR_WALL_COLOR}"`)
    expect(svg).toContain(`stroke-dasharray="${DOOR_DASH_IN.join(' ')}"`)
    expect(svg.match(/stroke-dasharray/g)).toHaveLength(1)
  })

  it('keeps the wall interruption and jambs identical whatever the door style', () => {
    const wall = makeWall()
    /** The interruption polygon and the two jamb lines — every non-path shape drawn. */
    const interruptionOf = (style: DoorStyle): string[] => {
      const svg = buildPlanSvg(makeDocument({ walls: [wall], openings: [makeOpening({ style })] }))
      return [...svg.matchAll(/<(?:polygon|line)[^>]*>/g)].map((match) => match[0])
    }

    const swing = interruptionOf('swing')
    expect(swing).toHaveLength(3)
    for (const style of ['double', 'sliding', 'bifold', 'double_bifold', 'pocket'] as const) {
      expect(interruptionOf(style)).toEqual(swing)
    }
  })

  it('draws no legend unless asked, then one panel inside the reserved column (spec X5)', () => {
    const document = makeRichDocument()

    expect(buildPlanSvg(document)).not.toContain('<g id="legend"')

    const svg = buildPlanSvg(document, { includeLegend: true })
    const viewBox = planViewBox(document, { includeLegend: true })
    const size = legendSizeOf(document)
    const x = viewBox.minX + viewBox.width - 12 - size.widthIn
    expect(svg).toContain(`<g id="legend" transform="translate(${x} ${viewBox.minY + 12})">`)
    expect(svg).toContain('>Legend<')
  })

  it('legends in the requested language, and only the circuits it exported (spec X5)', () => {
    const document = makeRichDocument({
      circuits: [makeCircuit({ id: 'c1' }), makeCircuit({ id: 'c2', name: 'Réseau' })],
    })

    const svg = buildPlanSvg(document, {
      includeLegend: true,
      legendLanguage: 'fr',
      circuitIds: ['c1'],
    })

    expect(svg).toContain('>Légende<')
    expect(svg).toContain('>Appareils<')
    expect(svg).not.toContain('Réseau')
  })

  it('excludes the annotations group when includeAnnotations is false', () => {
    const svg = buildPlanSvg(makeRichDocument(), { includeAnnotations: false })
    expect(svg).not.toContain('<g id="annotations">')
  })

  it('X4: guides are working geometry — excluded unless asked for (spec S9)', () => {
    const document = makeRichDocument({ guides: [FAR_GUIDE, WALL_GUIDE] })

    expect(buildPlanSvg(document)).not.toContain('id="guides"')
    expect(buildPlanSvg(document, { includeGuides: true })).toContain('<g id="guides">')
  })

  it('clips every included guide to the viewBox, whatever the guide reaches', () => {
    const document = makeRichDocument({ guides: [FAR_GUIDE, WALL_GUIDE] })
    const box = planViewBox(document)
    const svg = buildPlanSvg(document, { includeGuides: true })

    const group = guidesGroup(svg)
    const coordinates = [...group.matchAll(/x1="(-?[\d.]+)" y1="(-?[\d.]+)"/g)].flatMap((match) =>
      match.slice(1, 3).map(Number),
    )
    expect(coordinates).toHaveLength(4)
    for (const [x, y] of [
      [coordinates[0], coordinates[1]],
      [coordinates[2], coordinates[3]],
    ]) {
      expect(x).toBeGreaterThanOrEqual(box.minX)
      expect(x).toBeLessThanOrEqual(box.minX + box.width)
      expect(y).toBeGreaterThanOrEqual(box.minY)
      expect(y).toBeLessThanOrEqual(box.minY + box.height)
    }
    // Dashed muted hairlines, thinner than any real element.
    expect(group).toContain(`stroke="${EXPORT_INK_MUTED}"`)
    expect(group).toContain(`stroke-dasharray="${GUIDE_DASH_IN.join(' ')}"`)
    expect(group).toContain(`stroke-width="${GUIDE_STROKE_IN}"`)
  })

  it('never lets a guide move the viewBox, however far from the plan it lies', () => {
    const document = makeRichDocument()
    const withGuides = makeRichDocument({ guides: [FAR_GUIDE] })

    expect(planViewBox(withGuides, { includeGuides: true })).toEqual(planViewBox(document))
  })

  it('drops a guide that misses the page entirely', () => {
    const document = makeRichDocument({ guides: [OFF_PAGE_GUIDE] })

    expect(buildPlanSvg(document, { includeGuides: true })).not.toContain('id="guides"')
  })

  it('U4: a default export references neither /api/assets nor an <image>', () => {
    const document = makeRichDocument({ underlay: makeUnderlay() })
    const svg = buildPlanSvg(document)
    expect(svg).not.toContain('/api/assets')
    expect(svg).not.toContain('blob:')
    expect(svg).not.toContain('<image')
    expect(svg).not.toContain('id="underlay"')
  })

  it('embeds the underlay as an inline data URI (never a URL) when included', () => {
    const document = makeRichDocument({ underlay: makeUnderlay() })
    const embed: UnderlayEmbed = {
      dataUri: 'data:image/png;base64,AAAA',
      pixelWidth: 100,
      pixelHeight: 80,
    }
    const svg = buildPlanSvg(document, { includeUnderlay: true, underlay: embed })
    expect(svg).toContain('<g id="underlay"')
    expect(svg).toContain('<image href="data:image/png;base64,AAAA"')
    expect(svg).not.toContain('/api/assets')
    expect(svg).not.toContain('blob:')
  })
})

describe('embedUnderlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads the asset bytes and returns them as a data URI with the given pixel size', async () => {
    readAssetBlobMock.mockResolvedValue(new Blob(['image-bytes'], { type: 'image/png' }))

    const embed = await embedUnderlay(makeUnderlay({ image_ref: 'asset-42' }), {
      width: 640,
      height: 480,
    })

    expect(readAssetBlobMock).toHaveBeenCalledWith('asset-42')
    expect(embed.dataUri.startsWith('data:')).toBe(true)
    expect(embed.pixelWidth).toBe(640)
    expect(embed.pixelHeight).toBe(480)
  })

  it('propagates the failure when the asset bytes cannot be read', async () => {
    readAssetBlobMock.mockRejectedValue(new Error('Failed to load asset missing'))

    await expect(embedUnderlay(makeUnderlay(), { width: 1, height: 1 })).rejects.toThrow(
      /Failed to load asset/,
    )
  })
})
