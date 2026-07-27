import { mount } from '@vue/test-utils'
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import DevicePictogram from '@/components/editor/DevicePictogram.vue'
import DevicesLayer from '@/components/editor/DevicesLayer.vue'
import { DEVICE_TYPES } from '@/devices/catalog'
import { pictogramSymbolId } from '@/devices/pictograms'
import { EXPORT_INK } from '@/export/exportTheme'
import { buildPlanSvg } from '@/export/svgExport'
import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type { Circuit, DeviceType, PlanDocument } from '@/types/plan'
import { circuitsByDevice } from '@/utils/circuitMembership'
import { validatePlan } from '@/utils/circuits'
import { deviceScreenScale, deviceWorldPlacement } from '@/utils/geometry'
import { makeCircuit, makeDevice, makeDocument, makeWall, makeWire } from '../helpers/planFactory'

/**
 * Mounts the layer with the circuit membership its host derives, so the colour
 * assertions exercise the real document-driven map rather than a stub.
 */
function mountLayer(
  extraProps: Record<string, unknown> = {},
  pixelsPerInch = 2,
): VueWrapper<InstanceType<typeof DevicesLayer>> {
  const document = useEditorStore().document
  const membership: ReadonlyMap<string, readonly Circuit[]> = document
    ? circuitsByDevice(validatePlan(document), document.circuits)
    : new Map<string, readonly Circuit[]>()
  return mount(DevicesLayer, {
    props: { hairline: 0.5, pixelsPerInch, membership, ...extraProps },
  })
}

describe('DevicePictogram', () => {
  it('registers one symbol per device type (17/17)', () => {
    const wrapper = mount(DevicePictogram)
    const ids = wrapper.findAll('symbol').map((symbol) => symbol.attributes('id'))
    expect(ids).toHaveLength(17)
    expect(new Set(ids)).toEqual(new Set(DEVICE_TYPES.map(pictogramSymbolId)))
  })
})

describe('DevicesLayer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders an attached device as a <use> referencing its symbol', () => {
    const store = useEditorStore()
    store.document = makeDocument({ walls: [makeWall()], devices: [makeDevice({ id: 'd1' })] })

    const wrapper = mountLayer()
    const use = wrapper.find('use')
    expect(use.exists()).toBe(true)
    expect(use.attributes('href')).toBe(`#${pictogramSymbolId('outlet')}`)
    expect(use.attributes('transform')).toContain('translate')
  })

  it('renders a baseboard heater as its own oriented rectangle plus an inscribed glyph', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      walls: [makeWall()],
      devices: [makeDevice({ id: 'd1', type: 'baseboard_heater', length_in: 36 })],
    })

    const wrapper = mountLayer()
    // Left face at y = -1.75 on a 3.5" wall; the 36" x 3" rect protrudes into the room.
    expect(wrapper.find('polygon').attributes('points')).toBe('42,-1.75 78,-1.75 78,-4.75 42,-4.75')
    expect(wrapper.find('use').attributes('href')).toBe(`#${pictogramSymbolId('baseboard_heater')}`)
  })

  it('renders a free water heater at its true 22x22 size, glyph inscribed at the centre', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      devices: [
        makeDevice({
          id: 'd1',
          type: 'water_heater',
          attachment: null,
          position: { x: 0, y: 0 },
        }),
      ],
    })

    const wrapper = mountLayer()
    expect(wrapper.find('polygon').attributes('points')).toBe('-11,-11 11,-11 11,11 -11,11')
    // A footprint device's glyph offset is always 0 — the trailing translate is a no-op.
    expect(wrapper.find('use').attributes('transform')).toBe(
      'translate(0 0) rotate(0) scale(1) translate(0 0)',
    )
  })

  it('D4: zooming out shrinks the footprint rectangle but clamps only the glyph', () => {
    const store = useEditorStore()
    store.document = makeDocument({
      devices: [
        makeDevice({
          id: 'd1',
          type: 'water_heater',
          attachment: null,
          position: { x: 0, y: 0 },
        }),
      ],
    })

    const wrapper = mountLayer({}, 0.5)
    // The rectangle keeps its real world size — it is meant to shrink on screen.
    expect(wrapper.find('polygon').attributes('points')).toBe('-11,-11 11,-11 11,11 -11,11')
    // The glyph counter-scales to stay legible (14 px floor over a 6 px box).
    expect(wrapper.find('use').attributes('transform')).toContain(`scale(${14 / 6})`)
  })

  it("D4: keeps a wall symbol's baseline on the face at every zoom, not sinking into the wall as the glyph grows", () => {
    const store = useEditorStore()
    const wall = makeWall({ id: 'wall-1', thickness_in: 3.5 })
    store.document = makeDocument({
      walls: [wall],
      devices: [
        makeDevice({
          id: 'sw',
          type: 'switch',
          attachment: { wall_id: 'wall-1', segment_index: 0, t: 60, side: 'left' },
        }),
      ],
    })
    const placement = deviceWorldPlacement(store.document.devices[0], [wall])
    if (!placement) throw new Error('expected a placement')

    // At the default zoom the glyph is already legible (scale 1); at ppi 0.5
    // it hits the D4 floor (scale 14/6 ≈ 2.33) — the bug this fixes let the
    // offset sit OUTSIDE that scale, sinking the stem into the wall as it grew.
    for (const [pixelsPerInch, expectedScale] of [
      [2, 1],
      [0.5, deviceScreenScale(0.5)],
    ] as const) {
      const wrapper = mountLayer({}, pixelsPerInch)
      expect(requireGlyph(wrapper, 'switch').attributes('transform')).toBe(
        `translate(${placement.glyphAnchor.x} ${placement.glyphAnchor.y}) rotate(${placement.angleDeg}) ` +
          `scale(${expectedScale}) translate(0 ${-placement.glyphOffsetIn})`,
      )
    }
  })

  it('agrees with the SVG export on the glyph anchor and offset for a symbolic device (spec D1/D4)', () => {
    const store = useEditorStore()
    store.document = makeDocument({ walls: [makeWall()], devices: [makeDevice({ id: 'd1' })] })
    const placement = deviceWorldPlacement(store.document.devices[0], store.document.walls)
    if (!placement) throw new Error('expected a placement')

    const wrapper = mountLayer()
    expect(wrapper.find('use').attributes('transform')).toBe(
      `translate(${placement.glyphAnchor.x} ${placement.glyphAnchor.y}) rotate(${placement.angleDeg}) scale(1) translate(0 ${-placement.glyphOffsetIn})`,
    )
    const svg = buildPlanSvg(store.document)
    // The export never takes the D4 clamp (its scale is fixed at 1), but the
    // same anchor and offset compose the same `<g>` transform, just rounded to
    // 4 decimals (the export's coordinate convention) with the extra
    // recentring translate raw shapes need.
    const offsetIn = Number((-placement.glyphOffsetIn).toFixed(4))
    expect(svg).toContain(
      `translate(${placement.glyphAnchor.x} ${placement.glyphAnchor.y}) rotate(${placement.angleDeg}) scale(1) translate(0 ${offsetIn}) translate(-6 -6)`,
    )
  })

  it('hides all devices when the devices layer is toggled off', async () => {
    const store = useEditorStore()
    store.document = makeDocument({ walls: [makeWall()], devices: [makeDevice({ id: 'd1' })] })
    const layers = useLayersStore()

    const wrapper = mountLayer()
    expect(wrapper.find('use').exists()).toBe(true)

    layers.devicesVisible = false
    await wrapper.vm.$nextTick()
    expect(wrapper.find('use').exists()).toBe(false)
  })
})

const RED = '#dc2626'
const BLUE = '#2563eb'

/** The glyph of the (single) device of a type, or undefined when it isn't drawn. */
function glyphOf(wrapper: VueWrapper, type: DeviceType): DOMWrapper<Element> | undefined {
  return wrapper
    .findAll('use')
    .find((use) => use.attributes('href') === `#${pictogramSymbolId(type)}`)
}

/** Same, for the cases that must find one — a missing glyph fails the test. */
function requireGlyph(wrapper: VueWrapper, type: DeviceType): DOMWrapper<Element> {
  const glyph = glyphOf(wrapper, type)
  if (!glyph) throw new Error(`expected a ${type} glyph on the canvas`)
  return glyph
}

/** Tailwind colour classes on an element, '' when an explicit colour governs. */
function tintClass(element: DOMWrapper<Element>): string {
  return element.attributes('class') ?? ''
}

/**
 * A panel wired to an outlet and a baseboard heater on one red circuit, plus a
 * network jack wired to a second, blue data circuit and to the red one.
 */
function makeWiredDocument(overrides: Partial<PlanDocument> = {}): PlanDocument {
  return makeDocument({
    walls: [makeWall()],
    devices: [
      makeDevice({ id: 'p', type: 'panel', attachment: null, position: { x: 0, y: -40 } }),
      makeDevice({ id: 'o1', type: 'outlet' }),
      makeDevice({
        id: 'bb',
        type: 'baseboard_heater',
        attachment: { wall_id: 'wall-1', segment_index: 0, t: 20, side: 'left' },
      }),
      makeDevice({
        id: 'jack',
        type: 'network_jack',
        attachment: { wall_id: 'wall-1', segment_index: 0, t: 100, side: 'left' },
      }),
    ],
    circuits: [
      makeCircuit({ id: 'power', color: RED }),
      makeCircuit({ id: 'data', name: 'Data', kind: 'data', color: BLUE }),
    ],
    wires: [
      makeWire({ id: 'w1', circuit_id: 'power', from_device_id: 'p', to_device_id: 'o1' }),
      makeWire({ id: 'w2', circuit_id: 'power', from_device_id: 'o1', to_device_id: 'bb' }),
      // The jack joins the data circuit first, then the power one (spec C3).
      makeWire({ id: 'w3', circuit_id: 'data', from_device_id: 'p', to_device_id: 'jack' }),
      makeWire({ id: 'w4', circuit_id: 'power', from_device_id: 'o1', to_device_id: 'jack' }),
    ],
    ...overrides,
  })
}

describe('DevicesLayer circuit colour (spec C2)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it("paints a device on a circuit in the circuit's colour, footprint and glyph alike", () => {
    const store = useEditorStore()
    store.document = makeWiredDocument()

    const wrapper = mountLayer()
    const glyph = requireGlyph(wrapper, 'baseboard_heater')
    const footprint = wrapper
      .findAll('polygon')
      .find((polygon) => polygon.attributes('color') === RED)

    expect(glyph.attributes('color')).toBe(RED)
    expect(tintClass(glyph)).not.toContain('text-')
    expect(footprint?.exists()).toBe(true)
    expect(footprint?.attributes('stroke')).toBe('currentColor')
  })

  it('keeps the selection colour on a selected device, legible over any circuit colour', async () => {
    const store = useEditorStore()
    store.document = makeWiredDocument()

    const wrapper = mountLayer()
    store.select([{ kind: 'device', id: 'o1' }])
    await wrapper.vm.$nextTick()

    const glyph = requireGlyph(wrapper, 'outlet')
    expect(tintClass(glyph)).toContain('text-accent-strong')
    expect(glyph.attributes('color')).toBeUndefined()
  })

  it('leaves a source in ink — it belongs to every circuit', () => {
    const store = useEditorStore()
    store.document = makeWiredDocument()

    const wrapper = mountLayer()
    const glyph = requireGlyph(wrapper, 'panel')

    expect(tintClass(glyph)).toContain('text-ink')
    expect(glyph.attributes('color')).toBeUndefined()
  })

  it('paints a multi-circuit device with the FIRST circuit in document order (spec C3)', () => {
    const store = useEditorStore()
    store.document = makeWiredDocument()

    const wrapper = mountLayer()
    expect(requireGlyph(wrapper, 'network_jack').attributes('color')).toBe(RED)

    // Reversing the circuit list flips which colour the jack takes.
    store.document = makeWiredDocument({
      circuits: [
        makeCircuit({ id: 'data', name: 'Data', kind: 'data', color: BLUE }),
        makeCircuit({ id: 'power', color: RED }),
      ],
    })
    const reordered = mountLayer()
    expect(requireGlyph(reordered, 'network_jack').attributes('color')).toBe(BLUE)
  })

  it('leaves a device on no circuit in ink', () => {
    const store = useEditorStore()
    store.document = makeWiredDocument({ wires: [] })

    const wrapper = mountLayer()
    const glyph = requireGlyph(wrapper, 'outlet')

    expect(tintClass(glyph)).toContain('text-ink')
    expect(glyph.attributes('color')).toBeUndefined()
  })

  it('paints the placement preview in accent, whatever the document holds', () => {
    const store = useEditorStore()
    store.document = makeWiredDocument()

    const wrapper = mountLayer({ preview: makeDevice({ id: 'ghost', type: 'thermostat' }) })
    const glyph = requireGlyph(wrapper, 'thermostat')

    expect(tintClass(glyph)).toContain('text-accent')
    expect(glyph.attributes('color')).toBeUndefined()
  })

  it('agrees with the SVG export, device by device (spec C2/C6)', () => {
    const store = useEditorStore()
    const document = makeWiredDocument()
    store.document = document
    const svg = buildPlanSvg(document)

    const wrapper = mountLayer()
    for (const device of [document.devices[2], document.devices[0]]) {
      const rect = deviceWorldPlacement(device, document.walls)?.footprintRect
      if (!rect) throw new Error(`expected a footprint rectangle for ${device.id}`)
      const points = rect.map((point) => `${point.x},${point.y}`).join(' ')
      const canvas = wrapper
        .findAll('polygon')
        .find((polygon) => polygon.attributes('points') === points)
      // The canvas either carries an explicit circuit colour or inks via class;
      // the export must land on the very same colour for that same rectangle.
      const expected = canvas?.attributes('color') ?? EXPORT_INK
      expect(canvas?.exists()).toBe(true)
      expect(svg).toContain(`<polygon points="${points}" fill="none" stroke="${expected}"`)
    }
    // …and those two really are the coloured and the ink case.
    expect(svg).toContain(`stroke="${RED}"`)
    expect(svg).toContain(`stroke="${EXPORT_INK}"`)
  })

  it('keeps the circuit colour on a device dimmed by circuit isolation (spec C5)', () => {
    const store = useEditorStore()
    store.document = makeWiredDocument()

    const wrapper = mountLayer({ highlightDeviceIds: new Set(['jack']) })
    const glyph = requireGlyph(wrapper, 'outlet')

    expect(glyph.attributes('color')).toBe(RED)
    expect(glyph.attributes('opacity')).toBe('0.25')
  })
})

describe('DevicesLayer per-circuit device visibility (spec C6)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('hides the devices of a device-hidden circuit but never the sources', async () => {
    const store = useEditorStore()
    store.document = makeWiredDocument()
    const layers = useLayersStore()

    const wrapper = mountLayer()
    expect(glyphOf(wrapper, 'outlet')).toBeDefined()

    layers.setCircuitAxisVisible('power', 'devices', false)
    await wrapper.vm.$nextTick()

    expect(glyphOf(wrapper, 'outlet')).toBeUndefined()
    expect(glyphOf(wrapper, 'baseboard_heater')).toBeUndefined()
    expect(glyphOf(wrapper, 'panel')).toBeDefined()
    // The jack is also on the still-shown data circuit, so it stays.
    expect(glyphOf(wrapper, 'network_jack')).toBeDefined()
  })

  it('hides a multi-circuit device only once every one of its circuits is hidden', async () => {
    const store = useEditorStore()
    store.document = makeWiredDocument()
    const layers = useLayersStore()

    const wrapper = mountLayer()
    layers.setCircuitAxisVisible('power', 'devices', false)
    layers.setCircuitAxisVisible('data', 'devices', false)
    await wrapper.vm.$nextTick()

    expect(glyphOf(wrapper, 'network_jack')).toBeUndefined()
  })

  it('never hides a device on no circuit', async () => {
    const store = useEditorStore()
    store.document = makeWiredDocument({ wires: [] })
    const layers = useLayersStore()

    const wrapper = mountLayer()
    layers.setCircuitAxisVisible('power', 'devices', false)
    layers.setCircuitAxisVisible('data', 'devices', false)
    await wrapper.vm.$nextTick()

    expect(glyphOf(wrapper, 'outlet')).toBeDefined()
  })

  it('leaves devices alone when only the circuit WIRES are hidden', async () => {
    const store = useEditorStore()
    store.document = makeWiredDocument()
    const layers = useLayersStore()

    const wrapper = mountLayer()
    layers.setCircuitAxisVisible('power', 'wires', false)
    await wrapper.vm.$nextTick()

    expect(requireGlyph(wrapper, 'outlet').attributes('color')).toBe(RED)
  })
})
