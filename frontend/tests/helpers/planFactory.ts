import type {
  Circuit,
  ControlLink,
  Device,
  Dimension,
  Label,
  Opening,
  Plan,
  PlanDocument,
  Stairs,
  Underlay,
  Wall,
  Wire,
} from '@/types/plan'

/** Builds a straight 10' open wall on the x axis; override any field per test. */
export function makeWall(overrides: Partial<Wall> = {}): Wall {
  return {
    id: 'wall-1',
    vertices: [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
    ],
    thickness_in: 3.5,
    reference: 'center',
    closed: false,
    locked_segments: [],
    junctions: [],
    color: null,
    ...overrides,
  }
}

/** Builds a 32" door centred on the default wall's only segment; override per test. */
export function makeOpening(overrides: Partial<Opening> = {}): Opening {
  return {
    id: 'opening-1',
    kind: 'door',
    wall_id: 'wall-1',
    segment_index: 0,
    t: 60,
    width_in: 32,
    style: 'swing',
    hinge: 'left',
    swing: 'in',
    ...overrides,
  }
}

/** Builds an axis-aligned 36" x 96" stair run going right; override per test. */
export function makeStairs(overrides: Partial<Stairs> = {}): Stairs {
  return {
    id: 'stairs-1',
    origin: { x: 0, y: 0 },
    width_in: 36,
    length_in: 96,
    rotation_deg: 0,
    direction: 'up',
    ...overrides,
  }
}

/** Builds a default 8" room label at the origin; override per test. */
export function makeLabel(overrides: Partial<Label> = {}): Label {
  return {
    id: 'label-1',
    position: { x: 0, y: 0 },
    text: 'Room',
    size_in: 8,
    ...overrides,
  }
}

/** Builds a horizontal 10' dimension offset 12" below; override per test. */
export function makeDimension(overrides: Partial<Dimension> = {}): Dimension {
  return {
    id: 'dimension-1',
    p1: { x: 0, y: 0 },
    p2: { x: 120, y: 0 },
    offset_in: 12,
    ...overrides,
  }
}

/** Builds an outlet attached to the default wall's segment at t=60 on the left face; override per test. */
export function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: 'device-1',
    type: 'outlet',
    attachment: { wall_id: 'wall-1', segment_index: 0, t: 60, side: 'left' },
    position: null,
    rotation_deg: 0,
    label: null,
    load_w: null,
    length_in: null,
    depth_in: null,
    notes: null,
    ...overrides,
  }
}

/** Builds a 15 A / 120 V power circuit named "Circuit 1", red; override per test. */
export function makeCircuit(overrides: Partial<Circuit> = {}): Circuit {
  return {
    id: 'circuit-1',
    name: 'Circuit 1',
    color: '#dc2626',
    breaker_a: 15,
    voltage_v: 120,
    kind: 'power',
    ...overrides,
  }
}

/** Builds a wire from `panel` to `device-1` on `circuit-1` with a gentle curve; override per test. */
export function makeWire(overrides: Partial<Wire> = {}): Wire {
  return {
    id: 'wire-1',
    circuit_id: 'circuit-1',
    from_device_id: 'panel',
    to_device_id: 'device-1',
    control_points: [
      { x: 40, y: 6 },
      { x: 80, y: 6 },
    ],
    ...overrides,
  }
}

/** Builds a control link from a switch to a target device; override per test. */
export function makeControlLink(overrides: Partial<ControlLink> = {}): ControlLink {
  return {
    id: 'link-1',
    switch_id: 'switch-1',
    target_id: 'light-1',
    kind: 'controls',
    ...overrides,
  }
}

/** Builds a visible, unlocked underlay at origin, 1 in/px, 40% opacity; override per test. */
export function makeUnderlay(overrides: Partial<Underlay> = {}): Underlay {
  return {
    image_ref: 'asset-1',
    transform: { origin: { x: 0, y: 0 }, rotation_deg: 0, scale: 1 },
    opacity: 0.4,
    locked: false,
    visible: true,
    ...overrides,
  }
}

/** Builds a complete, empty v7 document; override any field per test. */
export function makeDocument(overrides: Partial<PlanDocument> = {}): PlanDocument {
  return {
    schema_version: 7,
    viewport: { center: { x: 0, y: 0 }, zoom: 1 },
    underlay: null,
    walls: [],
    openings: [],
    stairs: [],
    labels: [],
    dimensions: [],
    devices: [],
    thickness_presets_in: [12, 4.5, 3.5],
    catalog_defaults: {},
    display_precision_in: null,
    preset_lists: {},
    circuits: [],
    wires: [],
    control_links: [],
    active_tool: null,
    active_mode: null,
    ...overrides,
  }
}

/** Builds a full plan wrapping a (default empty) v7 document. */
export function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    name: 'Basement',
    description: '',
    revision: 3,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    archived_at: null,
    document: makeDocument(),
    ...overrides,
  }
}
