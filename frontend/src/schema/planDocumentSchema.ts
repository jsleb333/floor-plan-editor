import { z } from 'zod'

import { CIRCUIT_PALETTE } from '@/utils/circuits'

/**
 * The single definition of the persisted plan document's shape (spec X1). Every
 * type in `@/types/plan` that describes stored data is derived from a schema
 * here, so the shape cannot drift from the types the app compiles against.
 *
 * These schemas mirror the Pydantic models in `backend/models/` field for
 * field — same names, same constraints, same defaults — because the same JSON
 * is read by both. Defaults matter as much as constraints: a document written
 * by an older version of the app simply omits the fields added since, and it is
 * `.default()` here that fills them in, exactly as Pydantic does server-side.
 *
 * The reading policy is REPAIR, NOT REJECT (see {@link readPlanDocument}): a
 * plan that opens degraded beats one that will not open at all. Salvageable
 * scalars fall back with `.catch()`, and a collection drops only the elements
 * that cannot be read.
 */

/** The document shape this module writes; older documents are read and filled in. */
export const CURRENT_SCHEMA_VERSION = 10

/**
 * The version a document that carries no `schema_version` is read as, mirroring
 * `LEGACY_SCHEMA_VERSION` in `backend/constants.py`: the field only appeared
 * once there was a second version to distinguish.
 */
export const LEGACY_SCHEMA_VERSION = 1

/** Error `code` of {@link UnsupportedSchemaVersionError}. */
export const UNSUPPORTED_SCHEMA_VERSION_CODE = 'unsupported_schema_version'

/** Error `code` of {@link InvalidSchemaVersionError}. */
export const INVALID_SCHEMA_VERSION_CODE = 'invalid_schema_version'

/**
 * Thrown when a document claims a schema version above
 * {@link CURRENT_SCHEMA_VERSION}. Mirrors the backend
 * `UnsupportedSchemaVersionError`: forward migration is the only direction, so a
 * document written by a newer build cannot be read by this one.
 */
export class UnsupportedSchemaVersionError extends Error {
  readonly code = UNSUPPORTED_SCHEMA_VERSION_CODE

  constructor(readonly version: number) {
    super(
      `Document schema version ${version} is newer than the supported version ` +
        `${CURRENT_SCHEMA_VERSION}; documents are never downgraded.`,
    )
    this.name = 'UnsupportedSchemaVersionError'
  }
}

/**
 * Thrown when a document's `schema_version` is present but is not a finite
 * number. Unlike every other field, the version cannot fall back: which
 * defaults a document is missing is exactly what it tells us, so guessing it
 * would silently mis-read the rest.
 */
export class InvalidSchemaVersionError extends Error {
  readonly code = INVALID_SCHEMA_VERSION_CODE

  constructor(readonly value: unknown) {
    super(
      `Document schema version must be a number; read ${typeof value} ` +
        `'${String(value)}' instead.`,
    )
    this.name = 'InvalidSchemaVersionError'
  }
}

/** Every user-settable colour in a document is a `#rrggbb` string (spec S1f/C2). */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

/**
 * Seed wall thickness presets in inches, ordered [exterior, interior
 * alternative, interior default] (spec §5.9 tier 2).
 */
export const DEFAULT_THICKNESS_PRESETS_IN: readonly number[] = [12.0, 4.5, 3.5]

/** Thickness a wall falls back to when its stored value is not positive: the interior default. */
const FALLBACK_WALL_THICKNESS_IN = 3.5

/** Colour a circuit falls back to when its stored colour is not `#rrggbb` (spec C2). */
const FALLBACK_CIRCUIT_COLOR = CIRCUIT_PALETTE[0]

const DEFAULT_ZOOM = 1
const DEFAULT_UNDERLAY_OPACITY = 0.4
const DEFAULT_UNDERLAY_SCALE = 1
const DEFAULT_LABEL_SIZE_IN = 8
const DEFAULT_DIMENSION_OFFSET_IN = 12
const DEFAULT_BREAKER_A = 15

/** Issue code for an element removed because it named a wall the document no longer has. */
export const ORPHANED_WALL_REFERENCE_CODE = 'orphaned_wall_reference'

/** Issue code for a collection field that was not an array at all. */
export const INVALID_COLLECTION_CODE = 'invalid_collection'

function defaultViewport() {
  return { center: { x: 0, y: 0 }, zoom: DEFAULT_ZOOM }
}

function defaultUnderlayTransform() {
  return { origin: { x: 0, y: 0 }, rotation_deg: 0, scale: DEFAULT_UNDERLAY_SCALE }
}

function defaultThicknessPresets() {
  return [...DEFAULT_THICKNESS_PRESETS_IN]
}

export const pointSchema = z.object({
  x: z.number(),
  y: z.number(),
})

export const viewportSchema = z.object({
  center: pointSchema,
  zoom: z.number().positive().catch(DEFAULT_ZOOM),
})

export const wallEndSchema = z.enum(['start', 'end'])

export const wallSideSchema = z.enum(['left', 'right'])

export const wallSchema = z.object({
  id: z.string(),
  vertices: z.array(pointSchema).min(2),
  thickness_in: z.number().positive().catch(FALLBACK_WALL_THICKNESS_IN),
  reference: z.enum(['center', 'left', 'right']).default('center').catch('center'),
  closed: z.boolean().default(false).catch(false),
  locked_segments: z
    .array(z.number().int())
    .default(() => [])
    .catch(() => []),
  color: z.string().regex(HEX_COLOR_PATTERN).nullable().default(null).catch(null),
})

export const wallEndRefSchema = z.object({
  wall_id: z.string(),
  end: wallEndSchema,
})

export const wallBodyRefSchema = z.object({
  wall_id: z.string(),
  segment_index: z.number().int().min(0),
})

export const flushPartySchema = z.object({
  ref: z.union([wallEndRefSchema, wallBodyRefSchema]),
  side: wallSideSchema,
})

export const cornerJointSchema = z.object({
  id: z.string(),
  kind: z.literal('corner'),
  ends: z.array(wallEndRefSchema).min(2),
  rule: z.enum(['miter', 'square']).default('miter').catch('miter'),
})

export const teeJointSchema = z.object({
  id: z.string(),
  kind: z.literal('tee'),
  end: wallEndRefSchema,
  host: wallBodyRefSchema,
})

export const flushJointSchema = z.object({
  id: z.string(),
  kind: z.literal('flush'),
  a: flushPartySchema,
  b: flushPartySchema,
})

/**
 * `kind` carries no fallback on purpose: a joint whose discriminator is missing
 * or unknown says nothing about which walls relate how, so it is dropped. The
 * editor rebuilds joints from geometry when the collection ends up empty
 * (`healJoints` in `@/schema/jointHealing`).
 */
export const jointSchema = z.discriminatedUnion('kind', [
  cornerJointSchema,
  teeJointSchema,
  flushJointSchema,
])

export const surfaceGuideSchema = z.object({
  id: z.string(),
  kind: z.literal('surface'),
  wall_id: z.string(),
  segment_index: z.number().int().min(0),
  side: wallSideSchema,
  offset_in: z.number(),
})

export const pointGuideSchema = z.object({
  id: z.string(),
  kind: z.literal('point'),
  anchor: wallEndRefSchema,
  angle_deg: z.number(),
})

export const freeGuideSchema = z.object({
  id: z.string(),
  kind: z.literal('free'),
  origin: pointSchema,
  angle_deg: z.number(),
})

export const guideSchema = z.discriminatedUnion('kind', [
  surfaceGuideSchema,
  pointGuideSchema,
  freeGuideSchema,
])

export const doorStyleSchema = z.enum([
  'swing',
  'double',
  'sliding',
  'bifold',
  'double_bifold',
  'pocket',
])

export const openingSchema = z.object({
  id: z.string(),
  kind: z.enum(['door', 'window']),
  wall_id: z.string(),
  segment_index: z.number().int().min(0),
  t: z.number(),
  width_in: z.number().positive(),
  style: doorStyleSchema.default('swing').catch('swing'),
  hinge: wallSideSchema.default('left').catch('left'),
  swing: z.enum(['in', 'out']).default('in').catch('in'),
})

export const stairsSchema = z.object({
  id: z.string(),
  origin: pointSchema,
  width_in: z.number(),
  length_in: z.number(),
  rotation_deg: z.number().default(0).catch(0),
  direction: z.enum(['up', 'down']).default('up').catch('up'),
})

export const labelSchema = z.object({
  id: z.string(),
  position: pointSchema,
  text: z.string(),
  size_in: z.number().default(DEFAULT_LABEL_SIZE_IN).catch(DEFAULT_LABEL_SIZE_IN),
})

export const dimensionSchema = z.object({
  id: z.string(),
  p1: pointSchema,
  p2: pointSchema,
  offset_in: z.number().default(DEFAULT_DIMENSION_OFFSET_IN).catch(DEFAULT_DIMENSION_OFFSET_IN),
})

export const underlayTransformSchema = z.object({
  origin: pointSchema,
  rotation_deg: z.number().default(0).catch(0),
  scale: z.number().positive().default(DEFAULT_UNDERLAY_SCALE).catch(DEFAULT_UNDERLAY_SCALE),
})

/**
 * The placeable device types (spec §5.4, D5), mirroring the backend
 * `DeviceType`. `DEVICE_CATALOG` in `@/devices/catalog` is a
 * `Record<DeviceType, …>`, so a member missing here fails to compile there.
 */
export const deviceTypeSchema = z.enum([
  'outlet',
  'outlet_gfci',
  'switch',
  'switch_3way',
  'ceiling_light',
  'wall_light',
  'baseboard_heater',
  'thermostat',
  'water_heater',
  'air_exchanger',
  'central_vacuum',
  'vacuum_inlet',
  'smoke_detector',
  'network_jack',
  'panel',
  'feed_up',
  'feed_down',
])

export const deviceAttachmentSchema = z.object({
  wall_id: z.string(),
  segment_index: z.number().int().min(0),
  t: z.number(),
  side: wallSideSchema.default('left').catch('left'),
})

/**
 * `type` carries no fallback: an unknown type has no catalog row, and every
 * pictogram, load and footprint lookup goes through `DEVICE_CATALOG[type]`.
 * Neither placement is repaired either — a device whose stored attachment is
 * unreadable would be an invisible device with a phantom load.
 */
export const deviceSchema = z.object({
  id: z.string(),
  type: deviceTypeSchema,
  attachment: deviceAttachmentSchema.nullable().default(null),
  position: pointSchema.nullable().default(null),
  rotation_deg: z.number().default(0).catch(0),
  label: z.string().nullable().default(null).catch(null),
  load_w: z.number().nullable().default(null).catch(null),
  length_in: z.number().nullable().default(null).catch(null),
  depth_in: z.number().nullable().default(null).catch(null),
  notes: z.string().nullable().default(null).catch(null),
})

export const circuitSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z
    .string()
    .regex(HEX_COLOR_PATTERN)
    .default(FALLBACK_CIRCUIT_COLOR)
    .catch(FALLBACK_CIRCUIT_COLOR),
  breaker_a: z.number().int().positive().default(DEFAULT_BREAKER_A).catch(DEFAULT_BREAKER_A),
  voltage_v: z.literal([120, 240]).default(120).catch(120),
  kind: z.enum(['power', 'data', 'low_voltage']).default('power').catch('power'),
})

export const wireSchema = z.object({
  id: z.string(),
  circuit_id: z.string(),
  from_device_id: z.string(),
  to_device_id: z.string(),
  control_points: z
    .array(pointSchema)
    .default(() => [])
    .catch(() => []),
})

export const controlLinkSchema = z.object({
  id: z.string(),
  switch_id: z.string(),
  target_id: z.string(),
  kind: z.enum(['controls', 'three_way_pair']).default('controls').catch('controls'),
})

export const underlaySchema = z.object({
  image_ref: z.string(),
  transform: underlayTransformSchema
    .default(defaultUnderlayTransform)
    .catch(defaultUnderlayTransform),
  opacity: z
    .number()
    .min(0)
    .max(1)
    .default(DEFAULT_UNDERLAY_OPACITY)
    .catch(DEFAULT_UNDERLAY_OPACITY),
  locked: z.boolean().default(false).catch(false),
  visible: z.boolean().default(true).catch(true),
})

/**
 * The fields that are single values rather than collections. Each one carries
 * both a `.default()` and a `.catch()`, which is what lets
 * {@link readPlanDocument} parse them in one pass that cannot fail.
 *
 * `display_precision_in` is the one place this schema is stricter than the
 * backend model, which accepts any float: the length formatter divides by it
 * (`@/utils/units`), so a stored `0` renders every label as `Infinity`.
 */
const documentScalarShape = {
  schema_version: z.number().int().default(CURRENT_SCHEMA_VERSION).catch(CURRENT_SCHEMA_VERSION),
  viewport: viewportSchema.default(defaultViewport).catch(defaultViewport),
  underlay: underlaySchema.nullable().default(null).catch(null),
  /** Plan-level per-type default load in watts, keyed by device type (spec §5.9 tier 2). */
  catalog_defaults: z
    .record(z.string(), z.number())
    .default(() => ({}))
    .catch(() => ({})),
  /** Ordered [exterior, interior alternative, interior default] (spec §5.9 tier 2). */
  thickness_presets_in: z
    .array(z.number())
    .default(defaultThicknessPresets)
    .catch(defaultThicknessPresets),
  /** Per-plan display precision override in inches; `null` falls back to 1/8" (spec §5.9 tier 2). */
  display_precision_in: z.number().positive().nullable().default(null).catch(null),
  /**
   * Plan-grown option-button lists, keyed by a canonical name (spec §5.9 tier
   * 2, `@/utils/presetLists`) — e.g. `door_width`. A key absent from the map
   * means "use that list's built-in defaults", which is why a whole document
   * written before this field existed still resolves every list.
   */
  preset_lists: z
    .record(z.string(), z.array(z.number()))
    .default(() => ({}))
    .catch(() => ({})),
  /** Tool armed when the session was last saved, restored on open (spec P4/E9). */
  active_tool: z.string().nullable().default(null).catch(null),
  /** Workspace mode last active, restored on open (spec P4/E10); the frontend owns the valid ids. */
  active_mode: z.string().nullable().default(null).catch(null),
}

const documentCollectionShape = {
  walls: z.array(wallSchema).default(() => []),
  /**
   * How the walls connect (`docs/WALL_NETWORK.md`). Empty on a plan that has
   * walls means "not derived yet" — the editor rebuilds it from geometry on
   * open, which is also how a pre-v10 document arrives.
   */
  joints: z.array(jointSchema).default(() => []),
  /**
   * Infinite construction lines placed with the tape measure (spec S9). The
   * anchored kinds carry a relation rather than a position, so the geometry
   * resolves them from the walls they name on every edit.
   */
  guides: z.array(guideSchema).default(() => []),
  openings: z.array(openingSchema).default(() => []),
  stairs: z.array(stairsSchema).default(() => []),
  labels: z.array(labelSchema).default(() => []),
  dimensions: z.array(dimensionSchema).default(() => []),
  devices: z.array(deviceSchema).default(() => []),
  /** Colour-coded circuits fed from a source device (spec §5.5). */
  circuits: z.array(circuitSchema).default(() => []),
  /** Curved connections wiring devices into circuits (spec §5.6). */
  wires: z.array(wireSchema).default(() => []),
  /** Documentary switch-to-target control links (spec D6). */
  control_links: z.array(controlLinkSchema).default(() => []),
}

/**
 * The whole persisted document. Parsing this rejects a document outright when
 * any single element is unreadable, which is why callers reading a file from
 * disk go through {@link readPlanDocument} instead.
 */
export const planDocumentSchema = z.object({
  ...documentScalarShape,
  ...documentCollectionShape,
})

const documentScalarsSchema = z.object(documentScalarShape)

type ParsedPlanDocument = z.output<typeof planDocumentSchema>
type ParsedJoint = z.output<typeof jointSchema>
type ParsedGuide = z.output<typeof guideSchema>

/** One thing the reader had to repair or drop, small enough to persist or log. */
export interface DocumentIssue {
  /** Dot-joined location in the document, e.g. `walls.3.vertices`. */
  path: string
  /** The Zod issue code, or one of this module's own `*_CODE` constants. */
  code: string
  message: string
}

/** A document read from untrusted JSON, plus everything that had to be repaired. */
export interface PlanDocumentReadResult {
  /** The document, always stamped to {@link CURRENT_SCHEMA_VERSION}. */
  document: ParsedPlanDocument
  issues: DocumentIssue[]
  /** The version the document arrived as; {@link LEGACY_SCHEMA_VERSION} when it carried none. */
  fromVersion: number
  /** Whether the document arrived older than the current version, i.e. was brought forward. */
  migrated: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatPath(prefix: readonly (string | number)[], suffix: readonly PropertyKey[]): string {
  const parts = [
    ...prefix,
    ...suffix.map((part) => (typeof part === 'symbol' ? part.toString() : part)),
  ]
  return parts.join('.')
}

/**
 * Parses `raw` as an array of `schema`, keeping the elements that read and
 * recording an issue for each one that does not. Absent (or `null`) means the
 * empty collection, matching the backend model's `default_factory=list`.
 *
 * @param schema The element schema.
 * @param raw The unparsed field value.
 * @param field The field name, used as the reported issue path prefix.
 * @param issues Collector the failures are appended to.
 */
function parseCollection<Schema extends z.ZodType>(
  schema: Schema,
  raw: unknown,
  field: string,
  issues: DocumentIssue[],
): z.output<Schema>[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    issues.push({
      path: field,
      code: INVALID_COLLECTION_CODE,
      message: `Expected an array of ${field}; dropped the whole collection.`,
    })
    return []
  }
  const kept: z.output<Schema>[] = []
  raw.forEach((element: unknown, index) => {
    const result = schema.safeParse(element)
    if (result.success) {
      kept.push(result.data)
      return
    }
    for (const issue of result.error.issues) {
      issues.push({
        path: formatPath([field, index], issue.path),
        code: issue.code,
        message: issue.message,
      })
    }
  })
  return kept
}

/**
 * Drops the elements of `elements` that name a wall the document does not have.
 * A parametric address (spec §4.2) is only meaningful against a live wall, so
 * an opening or wall-mounted device left behind by a dropped wall has nowhere
 * to be drawn.
 */
function dropOrphans<Element extends { id: string }>(
  elements: Element[],
  field: string,
  wallIdsOf: (element: Element) => readonly string[],
  wallIds: ReadonlySet<string>,
  issues: DocumentIssue[],
): Element[] {
  return elements.filter((element, index) => {
    const missing = wallIdsOf(element).filter((wallId) => !wallIds.has(wallId))
    if (missing.length === 0) return true
    issues.push({
      path: formatPath([field, index], []),
      code: ORPHANED_WALL_REFERENCE_CODE,
      message: `Dropped ${field} ${element.id}: no wall '${missing.join("', '")}' in the document.`,
    })
    return false
  })
}

function guideWallId(guide: ParsedGuide): readonly string[] {
  switch (guide.kind) {
    case 'surface':
      return [guide.wall_id]
    case 'point':
      return [guide.anchor.wall_id]
    case 'free':
      return []
  }
}

/**
 * The joint with every reference to a missing wall removed: `joint` itself when
 * nothing referenced one, `null` when the relation no longer says anything. A
 * corner joint survives losing an end as long as two remain, because the
 * remaining ends still mitre against each other.
 */
function withLiveWalls(joint: ParsedJoint, wallIds: ReadonlySet<string>): ParsedJoint | null {
  switch (joint.kind) {
    case 'corner': {
      const ends = joint.ends.filter((end) => wallIds.has(end.wall_id))
      if (ends.length < 2) return null
      return ends.length === joint.ends.length ? joint : { ...joint, ends }
    }
    case 'tee':
      return wallIds.has(joint.end.wall_id) && wallIds.has(joint.host.wall_id) ? joint : null
    case 'flush':
      return wallIds.has(joint.a.ref.wall_id) && wallIds.has(joint.b.ref.wall_id) ? joint : null
  }
}

function pruneJoints(
  joints: ParsedJoint[],
  wallIds: ReadonlySet<string>,
  issues: DocumentIssue[],
): ParsedJoint[] {
  const kept: ParsedJoint[] = []
  joints.forEach((joint, index) => {
    const pruned = withLiveWalls(joint, wallIds)
    if (pruned === joint) {
      kept.push(joint)
      return
    }
    issues.push({
      path: formatPath(['joints', index], []),
      code: ORPHANED_WALL_REFERENCE_CODE,
      message:
        pruned === null
          ? `Dropped ${joint.kind} joint ${joint.id}: it names a wall that is not in the document.`
          : `Trimmed corner joint ${joint.id}: dropped the ends naming a missing wall.`,
    })
    if (pruned !== null) kept.push(pruned)
  })
  return kept
}

/**
 * Removes everything left dangling by a wall that is not in the document —
 * whether the wall was just dropped as unreadable, or was already missing.
 *
 * Device-to-device references are deliberately NOT pruned. A wire whose
 * endpoints do not resolve is a modelled, user-visible state: `validatePlan`
 * (`@/utils/circuits`) reports it as `dangling_wire_ids` and the Circuits panel
 * renders the finding, so dropping such wires would delete the very data the UI
 * exists to show. Control links are kept for the same reason.
 */
function dropWallOrphans(
  document: ParsedPlanDocument,
  issues: DocumentIssue[],
): ParsedPlanDocument {
  const wallIds = new Set(document.walls.map((wall) => wall.id))
  return {
    ...document,
    joints: pruneJoints(document.joints, wallIds, issues),
    guides: dropOrphans(document.guides, 'guides', guideWallId, wallIds, issues),
    openings: dropOrphans(document.openings, 'openings', (o) => [o.wall_id], wallIds, issues),
    devices: dropOrphans(
      document.devices,
      'devices',
      (device) => (device.attachment ? [device.attachment.wall_id] : []),
      wallIds,
      issues,
    ),
  }
}

/**
 * The version an incoming document is read as, mirroring the resolution in
 * `PlanMigrator.migrate` (`backend/core/plan_migrator.py`): an absent key means
 * the schema predates versioning, a fractional version is truncated to the
 * version whose shape it claims, and a version below the first one is read as
 * that first one rather than refused — a `0` says "before all of this", which
 * is what version 1 already means.
 *
 * @param raw The document's `schema_version` value, or `undefined` when absent.
 * @returns The resolved source version, between {@link LEGACY_SCHEMA_VERSION}
 *   and {@link CURRENT_SCHEMA_VERSION} inclusive.
 * @throws {InvalidSchemaVersionError} When the value is present but not a finite number.
 * @throws {UnsupportedSchemaVersionError} When the version is above the current one.
 */
function resolveSchemaVersion(raw: unknown): number {
  if (raw === undefined) return LEGACY_SCHEMA_VERSION
  if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new InvalidSchemaVersionError(raw)
  const version = Math.trunc(raw)
  if (version > CURRENT_SCHEMA_VERSION) throw new UnsupportedSchemaVersionError(version)
  return Math.max(version, LEGACY_SCHEMA_VERSION)
}

/**
 * Reads a plan document out of untrusted JSON, repairing rather than rejecting
 * (spec X1). Fields absent from an older document are filled with their
 * defaults, salvageable values fall back, unreadable collection elements are
 * dropped, and anything the drops left dangling goes with them. The returned
 * `issues` are what a caller shows the user as "we repaired N things".
 *
 * This is also the whole forward migration: every step the backend's
 * `PlanMigrator` performs is "give this new field its default", which is what
 * the `.default()`s below already do on read, and the two steps that instead
 * remove data (a pre-v10 wall's `junctions`) are covered by `z.object`
 * dropping unknown keys. The result is therefore stamped to
 * {@link CURRENT_SCHEMA_VERSION}, with `fromVersion` reporting where it came
 * from — reading an old document IS migrating it. What is deliberately NOT done
 * here is rebuilding derived geometry: see `healJoints` in
 * `@/schema/jointHealing`.
 *
 * @param raw The result of `JSON.parse` on a stored or imported document.
 * @throws {InvalidSchemaVersionError} When `schema_version` is present but not a finite number.
 * @throws {UnsupportedSchemaVersionError} When the document is newer than this build.
 */
export function readPlanDocument(raw: unknown): PlanDocumentReadResult {
  const issues: DocumentIssue[] = []
  if (!isRecord(raw)) {
    issues.push({
      path: '',
      code: INVALID_COLLECTION_CODE,
      message: 'Expected a plan document object; read an empty plan instead.',
    })
  }
  const source: Record<string, unknown> = isRecord(raw) ? raw : {}
  const fromVersion = resolveSchemaVersion(source.schema_version)
  const document: ParsedPlanDocument = {
    ...documentScalarsSchema.parse(source),
    schema_version: CURRENT_SCHEMA_VERSION,
    walls: parseCollection(wallSchema, source.walls, 'walls', issues),
    joints: parseCollection(jointSchema, source.joints, 'joints', issues),
    guides: parseCollection(guideSchema, source.guides, 'guides', issues),
    openings: parseCollection(openingSchema, source.openings, 'openings', issues),
    stairs: parseCollection(stairsSchema, source.stairs, 'stairs', issues),
    labels: parseCollection(labelSchema, source.labels, 'labels', issues),
    dimensions: parseCollection(dimensionSchema, source.dimensions, 'dimensions', issues),
    devices: parseCollection(deviceSchema, source.devices, 'devices', issues),
    circuits: parseCollection(circuitSchema, source.circuits, 'circuits', issues),
    wires: parseCollection(wireSchema, source.wires, 'wires', issues),
    control_links: parseCollection(
      controlLinkSchema,
      source.control_links,
      'control_links',
      issues,
    ),
  }
  return {
    document: dropWallOrphans(document, issues),
    issues,
    fromVersion,
    migrated: fromVersion < CURRENT_SCHEMA_VERSION,
  }
}
