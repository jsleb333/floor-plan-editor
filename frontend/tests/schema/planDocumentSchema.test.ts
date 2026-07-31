import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_THICKNESS_PRESETS_IN,
  ORPHANED_WALL_REFERENCE_CODE,
  readPlanDocument,
} from '@/schema/planDocumentSchema'
import { CIRCUIT_PALETTE, validatePlan } from '@/utils/circuits'
import { PRESET_LIST_NAMES, resolve as resolvePresetList } from '@/utils/presetLists'

const currentDir = dirname(fileURLToPath(import.meta.url))
/** The bundled demo plan, a genuine schema-v5 document (two directories above `frontend/`). */
const DEMO_DOCUMENT_PATH = resolve(currentDir, '../../../backend/app/demo/basement_demo.json')

const SEGMENT: readonly [{ x: number; y: number }, { x: number; y: number }] = [
  { x: 0, y: 0 },
  { x: 120, y: 0 },
]

function orphanIssuePaths(issues: readonly { path: string; code: string }[]): string[] {
  return issues.filter((issue) => issue.code === ORPHANED_WALL_REFERENCE_CODE).map((i) => i.path)
}

describe('readPlanDocument document defaults', () => {
  it('fills every defaulted field of an empty document', () => {
    const { document, issues } = readPlanDocument({})

    expect(issues).toEqual([])
    expect(document).toEqual({
      schema_version: CURRENT_SCHEMA_VERSION,
      viewport: { center: { x: 0, y: 0 }, zoom: 1 },
      underlay: null,
      walls: [],
      joints: [],
      guides: [],
      openings: [],
      stairs: [],
      labels: [],
      dimensions: [],
      devices: [],
      catalog_defaults: {},
      thickness_presets_in: [12, 4.5, 3.5],
      display_precision_in: null,
      preset_lists: {},
      circuits: [],
      wires: [],
      control_links: [],
      active_tool: null,
      active_mode: null,
    })
    expect(document.thickness_presets_in).toEqual([...DEFAULT_THICKNESS_PRESETS_IN])
  })

  it('defaults an absent preset_lists to an empty map, so preset resolution still works', () => {
    const { document } = readPlanDocument({ schema_version: 9, walls: [] })

    expect(document.preset_lists).toEqual({})
    expect(resolvePresetList(PRESET_LIST_NAMES.doorWidth, document)).toEqual([
      24, 28, 30, 32, 36, 48, 60,
    ])
  })

  it('defaults absent joints and guides to empty collections', () => {
    const { document, issues } = readPlanDocument({ schema_version: 9, walls: [] })

    expect(document.joints).toEqual([])
    expect(document.guides).toEqual([])
    expect(issues).toEqual([])
  })

  it('reads an empty plan out of a value that is not a document at all', () => {
    const { document, issues } = readPlanDocument('not a plan')

    expect(document.schema_version).toBe(CURRENT_SCHEMA_VERSION)
    expect(document.walls).toEqual([])
    expect(issues).toHaveLength(1)
  })

  it('falls back on every scalar field rather than failing the read', () => {
    const { document } = readPlanDocument({
      schema_version: 'ten',
      viewport: 'somewhere',
      underlay: 42,
      catalog_defaults: ['outlet'],
      thickness_presets_in: { exterior: 12 },
      display_precision_in: 0,
      preset_lists: 'door_width',
      active_tool: 7,
      active_mode: false,
    })

    expect(document).toEqual(readPlanDocument({}).document)
  })

  it('never shares a mutable default between two reads', () => {
    const first = readPlanDocument({}).document
    const second = readPlanDocument({}).document

    expect(first.viewport).not.toBe(second.viewport)
    expect(first.walls).not.toBe(second.walls)
    expect(first.thickness_presets_in).not.toBe(second.thickness_presets_in)
  })
})

describe('readPlanDocument element defaults', () => {
  it('fills every defaulted field of minimally specified elements', () => {
    const { document, issues } = readPlanDocument({
      walls: [{ id: 'w1', vertices: SEGMENT, thickness_in: 6 }],
      openings: [{ id: 'o1', kind: 'door', wall_id: 'w1', segment_index: 0, t: 24, width_in: 30 }],
      stairs: [{ id: 's1', origin: { x: 0, y: 0 }, width_in: 36, length_in: 96 }],
      labels: [{ id: 'l1', position: { x: 0, y: 0 }, text: 'Bedroom' }],
      dimensions: [{ id: 'dm1', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 } }],
      devices: [
        { id: 'd1', type: 'outlet', attachment: { wall_id: 'w1', segment_index: 0, t: 12 } },
      ],
      circuits: [{ id: 'c1', name: 'Outlets' }],
      wires: [{ id: 'wr1', circuit_id: 'c1', from_device_id: 'd1', to_device_id: 'd1' }],
      control_links: [{ id: 'cl1', switch_id: 'd1', target_id: 'd1' }],
      underlay: { image_ref: 'asset-1' },
    })

    expect(issues).toEqual([])
    expect(document.walls[0]).toEqual({
      id: 'w1',
      vertices: [...SEGMENT],
      thickness_in: 6,
      reference: 'center',
      closed: false,
      locked_segments: [],
      color: null,
    })
    expect(document.openings[0]).toMatchObject({ style: 'swing', hinge: 'left', swing: 'in' })
    expect(document.stairs[0]).toMatchObject({ rotation_deg: 0, direction: 'up' })
    expect(document.labels[0].size_in).toBe(8)
    expect(document.dimensions[0].offset_in).toBe(12)
    expect(document.devices[0]).toEqual({
      id: 'd1',
      type: 'outlet',
      attachment: { wall_id: 'w1', segment_index: 0, t: 12, side: 'left' },
      position: null,
      rotation_deg: 0,
      label: null,
      load_w: null,
      length_in: null,
      depth_in: null,
      notes: null,
    })
    expect(document.circuits[0]).toEqual({
      id: 'c1',
      name: 'Outlets',
      color: CIRCUIT_PALETTE[0],
      breaker_a: 15,
      voltage_v: 120,
      kind: 'power',
    })
    expect(document.wires[0].control_points).toEqual([])
    expect(document.control_links[0].kind).toBe('controls')
    expect(document.underlay).toEqual({
      image_ref: 'asset-1',
      transform: { origin: { x: 0, y: 0 }, rotation_deg: 0, scale: 1 },
      opacity: 0.4,
      locked: false,
      visible: true,
    })
  })
})

describe('readPlanDocument repairs', () => {
  it('clamps a non-positive wall thickness to the interior default', () => {
    const { document } = readPlanDocument({
      walls: [
        { id: 'w1', vertices: SEGMENT, thickness_in: 0 },
        { id: 'w2', vertices: SEGMENT, thickness_in: -12 },
      ],
    })

    expect(document.walls.map((wall) => wall.thickness_in)).toEqual([3.5, 3.5])
  })

  it('clamps an out-of-range underlay opacity, zoom and calibration scale', () => {
    const { document } = readPlanDocument({
      viewport: { center: { x: 5, y: 5 }, zoom: 0 },
      underlay: {
        image_ref: 'asset-1',
        opacity: 4.2,
        transform: { origin: { x: 0, y: 0 }, scale: 0 },
      },
    })

    expect(document.viewport).toEqual({ center: { x: 5, y: 5 }, zoom: 1 })
    expect(document.underlay?.opacity).toBe(0.4)
    expect(document.underlay?.transform.scale).toBe(1)
  })

  it('resets a colour that is not #rrggbb', () => {
    const { document } = readPlanDocument({
      walls: [{ id: 'w1', vertices: SEGMENT, thickness_in: 4, color: 'red' }],
      circuits: [{ id: 'c1', name: 'Outlets', color: 'rgb(1,2,3)' }],
    })

    expect(document.walls[0].color).toBeNull()
    expect(document.circuits[0].color).toBe(CIRCUIT_PALETTE[0])
  })

  it('resets an unknown enum value to its default', () => {
    const { document } = readPlanDocument({
      walls: [{ id: 'w1', vertices: SEGMENT, thickness_in: 4, reference: 'middle' }],
      openings: [
        {
          id: 'o1',
          kind: 'door',
          wall_id: 'w1',
          segment_index: 0,
          t: 24,
          width_in: 30,
          style: 'barn',
        },
      ],
      circuits: [{ id: 'c1', name: 'Outlets', color: '#112233', kind: 'magic' }],
    })

    expect(document.walls[0].reference).toBe('center')
    expect(document.openings[0].style).toBe('swing')
    expect(document.circuits[0].kind).toBe('power')
  })

  it('drops a device whose type has no catalog row', () => {
    const { document, issues } = readPlanDocument({
      devices: [
        { id: 'd1', type: 'toaster', position: { x: 0, y: 0 } },
        { id: 'd2', type: 'ceiling_light', position: { x: 0, y: 0 } },
      ],
    })

    expect(document.devices.map((device) => device.id)).toEqual(['d2'])
    expect(issues).toEqual([
      expect.objectContaining({ path: 'devices.0.type', code: 'invalid_value' }),
    ])
  })

  it('drops a whole collection that is not an array, keeping the rest of the document', () => {
    const { document, issues } = readPlanDocument({ walls: 'nope', labels: [] })

    expect(document.walls).toEqual([])
    expect(issues).toEqual([expect.objectContaining({ path: 'walls', code: 'invalid_collection' })])
  })
})

describe('readPlanDocument discriminated unions', () => {
  it('drops a joint whose kind is unknown or missing', () => {
    const { document, issues } = readPlanDocument({
      walls: [{ id: 'w1', vertices: SEGMENT, thickness_in: 4 }],
      joints: [
        { id: 'j1', kind: 'welded', ends: [{ wall_id: 'w1', end: 'start' }] },
        { id: 'j2', ends: [{ wall_id: 'w1', end: 'start' }] },
      ],
    })

    expect(document.joints).toEqual([])
    expect(issues.map((issue) => issue.path)).toEqual(['joints.0.kind', 'joints.1.kind'])
  })

  it('drops a guide whose kind is unknown or missing, keeping the readable ones', () => {
    const { document, issues } = readPlanDocument({
      guides: [
        { id: 'g1', kind: 'diagonal', origin: { x: 0, y: 0 }, angle_deg: 45 },
        { id: 'g2', origin: { x: 0, y: 0 }, angle_deg: 45 },
        { id: 'g3', kind: 'free', origin: { x: 0, y: 0 }, angle_deg: 45 },
      ],
    })

    expect(document.guides.map((guide) => guide.id)).toEqual(['g3'])
    expect(issues.map((issue) => issue.path)).toEqual(['guides.0.kind', 'guides.1.kind'])
  })

  it('drops a corner joint with fewer than two ends', () => {
    const { document, issues } = readPlanDocument({
      walls: [{ id: 'w1', vertices: SEGMENT, thickness_in: 4 }],
      joints: [{ id: 'j1', kind: 'corner', ends: [{ wall_id: 'w1', end: 'start' }] }],
    })

    expect(document.joints).toEqual([])
    expect(issues).toEqual([expect.objectContaining({ path: 'joints.0.ends', code: 'too_small' })])
  })
})

describe('readPlanDocument referential cleanup', () => {
  const documentWithBadWall = {
    walls: [
      { id: 'w-ok', vertices: SEGMENT, thickness_in: 4 },
      { id: 'w-bad', vertices: [{ x: 0, y: 0 }], thickness_in: 4 },
    ],
    joints: [
      {
        id: 'j-tee',
        kind: 'tee',
        end: { wall_id: 'w-bad', end: 'start' },
        host: { wall_id: 'w-ok', segment_index: 0 },
      },
      {
        id: 'j-corner',
        kind: 'corner',
        ends: [
          { wall_id: 'w-ok', end: 'start' },
          { wall_id: 'w-bad', end: 'end' },
        ],
      },
      {
        id: 'j-flush',
        kind: 'flush',
        a: { ref: { wall_id: 'w-ok', end: 'start' }, side: 'left' },
        b: { ref: { wall_id: 'w-bad', segment_index: 0 }, side: 'right' },
      },
    ],
    guides: [
      {
        id: 'g-surface',
        kind: 'surface',
        wall_id: 'w-bad',
        segment_index: 0,
        side: 'left',
        offset_in: 12,
      },
      { id: 'g-point', kind: 'point', anchor: { wall_id: 'w-bad', end: 'start' }, angle_deg: 0 },
      { id: 'g-free', kind: 'free', origin: { x: 0, y: 0 }, angle_deg: 45 },
    ],
    openings: [
      { id: 'o-ok', kind: 'door', wall_id: 'w-ok', segment_index: 0, t: 24, width_in: 30 },
      { id: 'o-orphan', kind: 'window', wall_id: 'w-bad', segment_index: 0, t: 24, width_in: 36 },
    ],
    devices: [
      { id: 'd-ok', type: 'outlet', attachment: { wall_id: 'w-ok', segment_index: 0, t: 12 } },
      { id: 'd-orphan', type: 'outlet', attachment: { wall_id: 'w-bad', segment_index: 0, t: 12 } },
      { id: 'd-free', type: 'ceiling_light', position: { x: 60, y: 60 } },
    ],
  }

  it('drops a wall with fewer than two vertices', () => {
    const { document, issues } = readPlanDocument(documentWithBadWall)

    expect(document.walls.map((wall) => wall.id)).toEqual(['w-ok'])
    expect(issues).toContainEqual(
      expect.objectContaining({ path: 'walls.1.vertices', code: 'too_small' }),
    )
  })

  it('drops everything the dropped wall left dangling', () => {
    const { document, issues } = readPlanDocument(documentWithBadWall)

    expect(document.openings.map((opening) => opening.id)).toEqual(['o-ok'])
    expect(document.devices.map((device) => device.id)).toEqual(['d-ok', 'd-free'])
    expect(document.joints).toEqual([])
    expect(document.guides.map((guide) => guide.id)).toEqual(['g-free'])
    expect(orphanIssuePaths(issues)).toEqual([
      'joints.0',
      'joints.1',
      'joints.2',
      'guides.0',
      'guides.1',
      'openings.1',
      'devices.1',
    ])
  })

  it('trims a corner joint that keeps two live ends instead of dropping it', () => {
    const { document, issues } = readPlanDocument({
      walls: [
        { id: 'w1', vertices: SEGMENT, thickness_in: 4 },
        { id: 'w2', vertices: SEGMENT, thickness_in: 4 },
      ],
      joints: [
        {
          id: 'j1',
          kind: 'corner',
          ends: [
            { wall_id: 'w1', end: 'start' },
            { wall_id: 'w2', end: 'start' },
            { wall_id: 'w-gone', end: 'start' },
          ],
        },
      ],
    })

    expect(document.joints).toEqual([
      {
        id: 'j1',
        kind: 'corner',
        rule: 'miter',
        ends: [
          { wall_id: 'w1', end: 'start' },
          { wall_id: 'w2', end: 'start' },
        ],
      },
    ])
    expect(orphanIssuePaths(issues)).toEqual(['joints.0'])
  })

  it('keeps a wire whose endpoints do not resolve, because the UI reports it as dangling', () => {
    const { document, issues } = readPlanDocument({
      devices: [{ id: 'panel', type: 'panel', position: { x: 0, y: 0 } }],
      circuits: [{ id: 'c1', name: 'Outlets', color: '#dc2626' }],
      wires: [
        { id: 'wr-dangling', circuit_id: 'c1', from_device_id: 'panel', to_device_id: 'deleted' },
      ],
    })

    expect(document.wires.map((wire) => wire.id)).toEqual(['wr-dangling'])
    expect(issues).toEqual([])
    expect(validatePlan(document).dangling_wire_ids).toEqual(['wr-dangling'])
  })
})

describe('readPlanDocument on the bundled demo document', () => {
  const raw: unknown = JSON.parse(readFileSync(DEMO_DOCUMENT_PATH, 'utf-8'))
  const { document, issues } = readPlanDocument(raw)

  it('reads the real schema-v5 document with no repairs at all', () => {
    expect(issues).toEqual([])
    expect(document.walls).toHaveLength(9)
    expect(document.devices).toHaveLength(49)
    expect(document.openings).toHaveLength(9)
    expect(document.wires).toHaveLength(46)
  })

  it('fills the fields the v5 document predates', () => {
    expect(document.preset_lists).toEqual({})
    expect(resolvePresetList(PRESET_LIST_NAMES.doorWidth, document)).toHaveLength(7)
    expect(document.joints).toEqual([])
    expect(document.guides).toEqual([])
    expect(document.display_precision_in).toBeNull()
    expect(document.active_tool).toBeNull()
    expect(document.active_mode).toBeNull()
    expect(document.openings.every((opening) => opening.style === 'swing')).toBe(true)
    expect(document.devices.every((device) => device.depth_in === null)).toBe(true)
    expect(document.walls.every((wall) => wall.color === null)).toBe(true)
  })

  it('strips the pre-v10 per-wall junctions the wall network replaced', () => {
    expect(document.walls.every((wall) => !('junctions' in wall))).toBe(true)
  })

  it('leaves the stored schema version alone: reading is not migrating', () => {
    expect(document.schema_version).toBe(5)
  })
})
