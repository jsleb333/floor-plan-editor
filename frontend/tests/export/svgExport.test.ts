import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildPlanSvg,
  embedUnderlay,
  planViewBox,
  slugify,
  type UnderlayEmbed,
} from '@/export/svgExport'
import type { PlanDocument } from '@/types/plan'
import { wallOutline } from '@/utils/geometry'
import { ringsToPath } from '@/utils/svgPath'

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
