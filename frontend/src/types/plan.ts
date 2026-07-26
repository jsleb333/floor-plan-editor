/** A 2D point in world coordinates. Units are inches (one drawing unit = 1 inch). */
export interface Point {
  x: number
  y: number
}

/** Persisted viewport state: world point at the screen centre and zoom factor (1 = 100%). */
export interface Viewport {
  center: Point
  zoom: number
}

/**
 * A T-junction record: one endpoint of a wall lives on another wall.
 * `t` is the distance in inches along the host segment's reference line from its start vertex.
 */
export interface WallEndAttachment {
  end: 'start' | 'end'
  host_wall_id: string
  segment_index: number
  t: number
}

/**
 * A wall chain stored as its reference polyline: vertices plus thickness and
 * the side the thickness is applied on. The rendered outline is derived, never stored.
 */
export interface Wall {
  id: string
  vertices: Point[]
  thickness_in: number
  reference: 'center' | 'left' | 'right'
  closed: boolean
  locked_segments: number[]
  junctions: WallEndAttachment[]
}

/**
 * A door or window hosted on a wall segment. `t` is the opening centre in inches
 * along the segment's reference line. `hinge` and `swing` are meaningful for doors only.
 */
export interface Opening {
  id: string
  kind: 'door' | 'window'
  wall_id: string
  segment_index: number
  t: number
  width_in: number
  hinge: 'left' | 'right'
  swing: 'in' | 'out'
}

/** A rectangular stair run anchored at `origin`, rotated by `rotation_deg` degrees. */
export interface Stairs {
  id: string
  origin: Point
  width_in: number
  length_in: number
  rotation_deg: number
  direction: 'up' | 'down'
}

/** A free-placed text label; `size_in` is the font size in inches of plan space. */
export interface Label {
  id: string
  position: Point
  text: string
  size_in: number
}

/** A persistent dimension line between two points, drawn offset by `offset_in` inches. */
export interface Dimension {
  id: string
  p1: Point
  p2: Point
  offset_in: number
}

/**
 * Placement of the underlay image in world space: the world position of the
 * image's top-left pixel, a rotation about that origin, and the calibration
 * scale in world INCHES per image PIXEL.
 */
export interface UnderlayTransform {
  origin: Point
  rotation_deg: number
  scale: number
}

/**
 * The catalog of placeable electrical device types (spec §5.4, D5).
 * Mirrors the backend `DeviceType` union exactly.
 */
export type DeviceType =
  | 'outlet'
  | 'outlet_gfci'
  | 'switch'
  | 'switch_3way'
  | 'ceiling_light'
  | 'wall_light'
  | 'baseboard_heater'
  | 'thermostat'
  | 'water_heater'
  | 'air_exchanger'
  | 'central_vacuum'
  | 'vacuum_inlet'
  | 'smoke_detector'
  | 'network_jack'
  | 'panel'
  | 'feed_up'
  | 'feed_down'

/**
 * Parametric host address of a wall-mounted device (spec §4.2). `t` is the
 * distance in inches from the segment start along the reference line; `side`
 * is the wall face the device sits on. World position is always derived.
 */
export interface DeviceAttachment {
  wall_id: string
  segment_index: number
  t: number
  side: 'left' | 'right'
}

/**
 * An electrical device placed on the plan (spec §5.4, §8). It carries EITHER a
 * parametric wall `attachment` (spec §4.2) OR an absolute `position` for
 * ceiling/free-standing devices, never both. `load_w` is a per-instance
 * override (`null` = the catalog/plan default applies); `length_in` and
 * `depth_in` override the type's catalog footprint ALONG the wall and ACROSS,
 * into the room (`null` = that dimension of the footprint applies, and both are
 * meaningless for symbolic types that have no real size).
 */
export interface Device {
  id: string
  type: DeviceType
  attachment: DeviceAttachment | null
  position: Point | null
  rotation_deg: number
  label: string | null
  load_w: number | null
  length_in: number | null
  depth_in: number | null
  notes: string | null
}

/**
 * A named, colour-coded group of devices protected by one breaker (spec C1/C2).
 * `color` is the circuit's identity on the canvas (`#rrggbb`); `kind` `power`
 * carries load, while `data`/`low_voltage` pseudo-circuits carry none (spec C3).
 * Mirrors the backend `Circuit` model.
 */
export interface Circuit {
  id: string
  name: string
  color: string
  breaker_a: number
  voltage_v: 120 | 240
  kind: 'power' | 'data' | 'low_voltage'
}

/**
 * A curved connection between two devices on one circuit (spec §5.6, §8).
 * Endpoints reference device ids (never coordinates) so wires follow their
 * devices; only the interior cubic-Bézier `control_points` are absolute.
 */
export interface Wire {
  id: string
  circuit_id: string
  from_device_id: string
  to_device_id: string
  control_points: Point[]
}

/**
 * A documentary link from a switch to what it controls (spec D6). `controls`
 * links a switch to a light/device; `three_way_pair` pairs two 3-way switches.
 * No load impact; rendered as a dashed arc on hover/selection only.
 */
export interface ControlLink {
  id: string
  switch_id: string
  target_id: string
  kind: 'controls' | 'three_way_pair'
}

/** A raster image (photo/scan) displayed under the plan for tracing (spec §5.2). */
export interface Underlay {
  /** Server-stored asset id (see `POST /api/assets`). */
  image_ref: string
  transform: UnderlayTransform
  opacity: number
  locked: boolean
  visible: boolean
}

/**
 * The versioned plan document — everything the editor persists via autosave.
 * Schema version 7: adds the per-plan `display_precision_in` override (spec
 * §5.9 tier 2) on top of the v6 persisted `active_tool` (spec P4/E9), the v5
 * electrical layout — colour-coded `circuits`, the `wires` connecting
 * devices into them (spec §5.6) and the documentary switch `control_links`
 * (spec D6) — the v4 devices and catalog defaults, structure collections,
 * wall thickness presets and tracing underlay. `preset_lists` is additive
 * (no schema bump): it generalizes the wall-thickness-presets idea to any
 * plan-grown option-button list.
 */
export interface PlanDocument {
  schema_version: number
  viewport: Viewport
  underlay: Underlay | null
  walls: Wall[]
  openings: Opening[]
  stairs: Stairs[]
  labels: Label[]
  dimensions: Dimension[]
  devices: Device[]
  thickness_presets_in: number[]
  /** Plan-level per-type default load in watts (spec §5.9 tier 2). */
  catalog_defaults: Record<string, number>
  /** Per-plan display precision override in inches; `null` falls back to 1/8" (spec §5.9 tier 2). */
  display_precision_in: number | null
  /**
   * Plan-grown option-button lists, keyed by a canonical name (spec §5.9 tier
   * 2, `frontend/src/utils/presetLists.ts`) — e.g. `door_width`. A key absent
   * from the map means "use that list's built-in defaults".
   */
  preset_lists: Record<string, number[]>
  /** Colour-coded circuits fed from a source device (spec §5.5). */
  circuits: Circuit[]
  /** Curved connections wiring devices into circuits (spec §5.6). */
  wires: Wire[]
  /** Documentary switch-to-target control links (spec D6). */
  control_links: ControlLink[]
  /** Tool armed when the session was last saved, restored on open (spec P4/E9). */
  active_tool: string | null
}

/** The computed electrical state of one circuit (spec C4/W4). Mirrors backend `CircuitLoad`. */
export interface CircuitLoad {
  circuit_id: string
  load_w: number
  /** Amperage (watts ÷ voltage), or `null` for data/low-voltage circuits. */
  amps: number | null
  breaker_a: number
  status: 'ok' | 'warning' | 'over'
  connected_device_ids: string[]
  floating_device_ids: string[]
}

/**
 * The full circuit validation result for a plan (spec C4/C5/W4). Mirrors the
 * backend `PlanValidation` returned by `GET /api/plans/{id}/validation`; the
 * client computes the same shape live during editing (spec §8).
 */
export interface PlanValidation {
  circuits: CircuitLoad[]
  unassigned_device_ids: string[]
  multi_circuit_device_ids: Record<string, string[]>
  dangling_wire_ids: string[]
  /** Whether the plan has at least one connectivity root: a panel or a feed (spec C1). */
  has_source: boolean
}

/** A full plan as returned by the API. */
export interface Plan {
  id: string
  name: string
  /** Optional free text shown under the name on the home-page card (spec P5). */
  description: string
  revision: number
  created_at: string
  updated_at: string
  archived_at: string | null
  document: PlanDocument
}

/** Lightweight plan metadata for the home page listing. */
export interface PlanSummary {
  id: string
  name: string
  /** Optional free text shown under the name on the home-page card (spec P5). */
  description: string
  updated_at: string
  archived_at: string | null
}
