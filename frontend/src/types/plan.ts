import type { z } from 'zod'

import type {
  circuitSchema,
  controlLinkSchema,
  cornerJointSchema,
  deviceAttachmentSchema,
  deviceSchema,
  deviceTypeSchema,
  dimensionSchema,
  doorStyleSchema,
  flushJointSchema,
  flushPartySchema,
  freeGuideSchema,
  guideSchema,
  jointSchema,
  labelSchema,
  openingSchema,
  planDocumentSchema,
  pointGuideSchema,
  pointSchema,
  stairsSchema,
  surfaceGuideSchema,
  teeJointSchema,
  underlaySchema,
  underlayTransformSchema,
  viewportSchema,
  wallBodyRefSchema,
  wallEndRefSchema,
  wallEndSchema,
  wallSchema,
  wallSideSchema,
  wireSchema,
} from '@/schema/planDocumentSchema'

/**
 * The shape of everything a plan persists. Every document type below is derived
 * from its Zod schema in `@/schema/planDocumentSchema`, which mirrors the
 * backend Pydantic model field for field — one definition of the document,
 * enforced at both the type level and at read time. The records and derived
 * results at the bottom of this file are not document shape and stay
 * hand-written.
 */

/** A 2D point in world coordinates. Units are inches (one drawing unit = 1 inch). */
export type Point = z.output<typeof pointSchema>

/** Persisted viewport state: world point at the screen centre and zoom factor (1 = 100%). */
export type Viewport = z.output<typeof viewportSchema>

/**
 * A wall chain stored as its reference polyline: vertices plus thickness and
 * the side the thickness is applied on. The rendered outline is derived, never
 * stored, and connectivity to other walls lives in `PlanDocument.joints` rather
 * than here, so a relation is symmetric and one place owns it.
 * `color` (`#rrggbb`) overrides the drawn wall body; `null` takes the role
 * default derived from the plan's thickness presets (spec S1f).
 */
export type Wall = z.output<typeof wallSchema>

/** Which end of a wall chain a joint attaches to. */
export type WallEnd = z.output<typeof wallEndSchema>

/** One of a wall's two surfaces, named relative to its drawing direction. */
export type WallSide = z.output<typeof wallSideSchema>

/** One wall end participating in a joint. */
export type WallEndRef = z.output<typeof wallEndRefSchema>

/** A wall body a joint passes through, identified by the segment it crosses. */
export type WallBodyRef = z.output<typeof wallBodyRefSchema>

/** One party of a flush relation: a wall end or body, and which of its surfaces is shared. */
export type FlushParty = z.output<typeof flushPartySchema>

/**
 * Wall ends whose spines meet at one point (2 or more). Faces resolve pairwise
 * in angular order, so this covers L-corners, three-way meetings and a chain
 * split across separate walls alike. `rule` 'square' suppresses the mitre.
 */
export type CornerJoint = z.output<typeof cornerJointSchema>

/** One wall end abutting another wall's body. The host's own geometry is unaffected. */
export type TeeJoint = z.output<typeof teeJointSchema>

/**
 * A declaration that two surfaces are ONE surface (`docs/WALL_NETWORK.md` §4).
 * The parties' spines are parallel and offset by half the thickness
 * difference, which is what makes walls of unequal thickness read as one body.
 */
export type FlushJoint = z.output<typeof flushJointSchema>

/**
 * A stored relation between walls (`docs/WALL_NETWORK.md` §3). `corner` and
 * `tee` are topology — they assert coincidence, which the constraint solver
 * maintains. `flush` is the only kind that may offset a spine.
 */
export type Joint = z.output<typeof jointSchema>

/**
 * A guide anchored to a wall surface (spec S9): the line parallel to the named
 * segment's surface on `side`, `offset_in` inches OUTWARD from it (away from
 * the wall body). Stored as a relation, not a coordinate, so the guide keeps
 * its offset when the wall moves or changes thickness.
 */
export type SurfaceGuide = z.output<typeof surfaceGuideSchema>

/**
 * A guide through a wall end (spec S9), at `angle_deg` from the +x axis toward
 * +y. Anchored to the point, so it follows that corner through edits.
 */
export type PointGuide = z.output<typeof pointGuideSchema>

/** A construction line anchored to nothing: through `origin` at `angle_deg` (spec S9). */
export type FreeGuide = z.output<typeof freeGuideSchema>

/**
 * An infinite construction line placed with the tape measure (spec S9). The
 * anchored kinds name the wall they were measured from rather than a position,
 * so the geometry re-derives them on every edit
 * (`frontend/src/utils/geometry/network/guideLine.ts`).
 */
export type Guide = z.output<typeof guideSchema>

/**
 * The leaf configuration of a door (spec S4). Mirrors the backend `Opening.style`
 * union; it decides which of `hinge`/`swing` the drawn symbol reads.
 */
export type DoorStyle = z.output<typeof doorStyleSchema>

/**
 * A door or window hosted on a wall segment. `t` is the opening centre in inches
 * along the segment's reference line. `style`, `hinge` and `swing` are meaningful
 * for doors only.
 */
export type Opening = z.output<typeof openingSchema>

/** A rectangular stair run anchored at `origin`, rotated by `rotation_deg` degrees. */
export type Stairs = z.output<typeof stairsSchema>

/** A free-placed text label; `size_in` is the font size in inches of plan space. */
export type Label = z.output<typeof labelSchema>

/** A persistent dimension line between two points, drawn offset by `offset_in` inches. */
export type Dimension = z.output<typeof dimensionSchema>

/**
 * Placement of the underlay image in world space: the world position of the
 * image's top-left pixel, a rotation about that origin, and the calibration
 * scale in world INCHES per image PIXEL.
 */
export type UnderlayTransform = z.output<typeof underlayTransformSchema>

/**
 * The catalog of placeable electrical device types (spec §5.4, D5).
 * Mirrors the backend `DeviceType` union exactly.
 */
export type DeviceType = z.output<typeof deviceTypeSchema>

/**
 * Parametric host address of a wall-mounted device (spec §4.2). `t` is the
 * distance in inches from the segment start along the reference line; `side`
 * is the wall face the device sits on. World position is always derived.
 */
export type DeviceAttachment = z.output<typeof deviceAttachmentSchema>

/**
 * An electrical device placed on the plan (spec §5.4, §8). It carries EITHER a
 * parametric wall `attachment` (spec §4.2) OR an absolute `position` for
 * ceiling/free-standing devices, never both. `load_w` is a per-instance
 * override (`null` = the catalog/plan default applies); `length_in` and
 * `depth_in` override the type's catalog footprint ALONG the wall and ACROSS,
 * into the room (`null` = that dimension of the footprint applies, and both are
 * meaningless for symbolic types that have no real size).
 */
export type Device = z.output<typeof deviceSchema>

/**
 * A named, colour-coded group of devices protected by one breaker (spec C1/C2).
 * `color` is the circuit's identity on the canvas (`#rrggbb`); `kind` `power`
 * carries load, while `data`/`low_voltage` pseudo-circuits carry none (spec C3).
 * Mirrors the backend `Circuit` model.
 */
export type Circuit = z.output<typeof circuitSchema>

/**
 * A curved connection between two devices on one circuit (spec §5.6, §8).
 * Endpoints reference device ids (never coordinates) so wires follow their
 * devices; only the interior cubic-Bézier `control_points` are absolute.
 */
export type Wire = z.output<typeof wireSchema>

/**
 * A documentary link from a switch to what it controls (spec D6). `controls`
 * links a switch to a light/device; `three_way_pair` pairs two 3-way switches.
 * No load impact; rendered as a dashed arc on hover/selection only.
 */
export type ControlLink = z.output<typeof controlLinkSchema>

/**
 * A raster image (photo/scan) displayed under the plan for tracing (spec §5.2).
 * `image_ref` is the stored asset id (see `POST /api/assets`).
 */
export type Underlay = z.output<typeof underlaySchema>

/**
 * The versioned plan document — everything the editor persists via autosave.
 * Schema version 10: moves wall connectivity into document-level `joints`
 * (`docs/WALL_NETWORK.md`) and adds the custom `guides` (spec S9), on top of
 * the v9 persisted `active_mode` (spec P4/E10), the v8 per-wall `color`
 * override (spec S1f) and the v8 move
 * of wall connectivity off the walls into `joints`
 * (`docs/WALL_NETWORK.md`), the v7 per-plan `display_precision_in`
 * override (spec §5.9 tier 2), the v6 persisted `active_tool` (spec P4/E9), the v5
 * electrical layout — colour-coded `circuits`, the `wires` connecting
 * devices into them (spec §5.6) and the documentary switch `control_links`
 * (spec D6) — the v4 devices and catalog defaults, structure collections,
 * wall thickness presets and tracing underlay. `preset_lists` is additive
 * (no schema bump): it generalizes the wall-thickness-presets idea to any
 * plan-grown option-button list.
 *
 * Every field's type, constraint and default lives on `planDocumentSchema`,
 * which also documents what happens to each one when a stored value is
 * unreadable.
 */
export type PlanDocument = z.output<typeof planDocumentSchema>

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
