import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEVICE_STROKE_IN, EXPORT_INK, EXPORT_WALL_EDGE } from '@/export/exportTheme'
import {
  buildPlanSvg,
  embedUnderlay,
  planViewBox,
  slugify,
  type UnderlayEmbed,
} from '@/export/svgExport'
import type { DoorStyle, PlanDocument, Point } from '@/types/plan'
import { DOOR_DASH_IN, deviceWorldPlacement, doorFigure, wallOutline } from '@/utils/geometry'
import { doorStrokeToPath, ringsToPath } from '@/utils/svgPath'

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

/** The default circuit colour of `makeCircuit`, and a contrasting second one. */
const RED = '#dc2626'
const BLUE = '#2563eb'
/** Where the free-standing panel sits in these documents. */
const PANEL: Point = { x: 0, y: -20 }

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

    expect(svg).toContain(`<path d="M 44 0 L 12 0" fill="none" stroke="${EXPORT_WALL_EDGE}"`)
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

  it('excludes the annotations group when includeAnnotations is false', () => {
    const svg = buildPlanSvg(makeRichDocument(), { includeAnnotations: false })
    expect(svg).not.toContain('<g id="annotations">')
  })

  it('U4: a default export references neither /api/assets nor an <image>', () => {
    const document = makeRichDocument({ underlay: makeUnderlay() })
    const svg = buildPlanSvg(document)
    expect(svg).not.toContain('/api/assets')
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
  })
})

describe('embedUnderlay', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the asset and returns its bytes as a data URI with the given pixel size', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['image-bytes'], { type: 'image/png' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const embed = await embedUnderlay(makeUnderlay({ image_ref: 'asset-42' }), {
      width: 640,
      height: 480,
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/assets/asset-42')
    expect(embed.dataUri.startsWith('data:')).toBe(true)
    expect(embed.pixelWidth).toBe(640)
    expect(embed.pixelHeight).toBe(480)
  })

  it('throws a clear error when the asset fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(embedUnderlay(makeUnderlay(), { width: 1, height: 1 })).rejects.toThrow(
      /underlay image/,
    )
  })
})
