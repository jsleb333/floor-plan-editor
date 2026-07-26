# Architecture

How the floor plan editor actually works, aimed at someone about to change
it. [REQUIREMENTS.md](REQUIREMENTS.md) explains *what* the product does and
*why* the design decisions were made; this document maps *where* everything
lives and how the pieces fit. Coding conventions and layering rules are in
[.claude/CLAUDE.md](../.claude/CLAUDE.md).

## The big picture

The system is deliberately lopsided:

- The **backend** (`backend/`) is a thin persistence and validation service:
  it stores plan documents in SQLite, migrates old schema versions forward,
  validates circuit loads, and serves underlay images. It knows nothing about
  editing.
- The **frontend** (`frontend/src/`) owns everything interactive: geometry
  derivation, rendering, tools, undo/redo, snapping, export. The canvas is a
  single SVG tree rendered by Vue components.

The contract between them is the **plan document** — one versioned JSON blob
(`PlanDocument`, defined twice and kept in sync: Pydantic in
`backend/models/plan_document.py`, TypeScript in `frontend/src/types/plan.ts`).
The editor mutates its in-memory copy and autosaves the whole document; the
backend never sees fine-grained edits.

```
 user input                                    ┌──────────────────────┐
     │                                         │ backend              │
     ▼                                         │                      │
 tool composable ──commit──▶ editor store ──▶  │ PUT /api/plans/{id}  │
     │                        │  (debounced    │  revision check      │
     ▼                        │   autosave)    │  SQLite JSON column  │
 preview overlay              ▼                └──────────────────────┘
                          documentVersion++
                              │
                              ▼
                  layers re-derive geometry and re-render
```

## Stored vs derived

The single most important invariant: **the document stores intent, never
derived geometry.** Everything visual is recomputed on every change from the
pure functions in `frontend/src/utils/geometry/`.

| Stored (persisted in the document) | Derived (recomputed, never persisted) |
|---|---|
| Wall reference polyline + `thickness_in` + `reference` side + `closed` + `locked_segments` + `junctions` | Wall outline rings, mitred corners, butt caps, T-junction trims |
| Opening `{wall_id, segment_index, t, width_in, …}` | Jambs, opening rect, door swing arc, window glazing lines |
| Attached device `{wall_id, segment_index, t, side}` (+ optional `length_in`/`depth_in`) | World anchor, pictogram rotation, hit bounds, footprint rect |
| Free device `position` + `rotation_deg` (+ optional `length_in`/`depth_in`) | Hit bounds, footprint rect |
| Wire `{from_device_id, to_device_id, control_points}` | Endpoint world positions, Bézier path |
| Stairs `{origin, rotation_deg, width_in, length_in, direction}` | Corners, treads, direction arrow |
| Dimension `{p1, p2, offset_in}` | Extension lines, ticks, live distance text |

Two consequences worth internalizing:

- Attachments are **parametric addresses**, not coordinates (REQUIREMENTS
  §4.2). Moving a wall moves its openings, devices and their wires for free,
  because their world positions are resolved through the wall on every render.
- The live canvas and the SVG export call the **same geometry functions**, so
  what you see is exactly what exports, and there is one implementation to
  test.

## Backend

### Layering and dependency injection

Hexagonal: `api/` (HTTP) → `core/services/` (business logic) →
`interfaces/` (ABC ports) ← `infra/` (adapters). Everything
instance-specific sits outside the hexagon in `backend/app/` — the
composition root: settings, container, app factory and startup tasks.
`backend/app/container.py` defines a single dishka `AppProvider` with
`Scope.APP` — everything is a singleton, including one shared `aiosqlite`
connection used by both repositories. Routes receive services via
`FromDishka[...]` parameters. Core never imports `AppSettings`: the
container extracts the narrow values core components declare (e.g.
`MaxAssetSizeBytes`) and injects those instead.

### Plan lifecycle, revisions, migrations

`PlanService` (`backend/core/services/plan_service.py`) owns the lifecycle:
create, list, rename, duplicate, archive/restore (soft delete —
`archived_at` timestamp, never row deletion), and permanent delete (refused
unless already archived).

**Optimistic concurrency**: every document write is
`UPDATE plans SET document=?, revision = revision + 1 WHERE id=? AND revision=?`
(`backend/infra/sqlite_plan_repository.py`). A zero rowcount means the caller
held a stale revision → `RevisionConflictError` → HTTP 409 → the client
reloads the plan.

**Schema migrations**: `PlanMigrator` (`backend/core/plan_migrator.py`) walks
raw document dicts forward one version at a time, using step functions keyed
by the version they migrate *from* (`{1: _migrate_v1_to_v2, …}`). The current
version lives in `backend/constants.py` (`CURRENT_SCHEMA_VERSION`, currently
5). Migration happens lazily in `PlanService.get_plan`: the repository returns
an *un-validated* `RawPlanRecord` (dict document), the migrator upgrades it,
and only then is it validated into `PlanDocument`. If a migration ran, a
pre-migration copy is written to the `document_backups` table
(`INSERT OR IGNORE` keyed on `(plan_id, from_version)`, so the oldest copy
per version is kept forever) before the upgraded document is persisted.
Documents *newer* than the backend raise `UnsupportedSchemaVersionError` —
never downgraded, never destroyed. The step-by-step recipe is in
[RECIPES.md](RECIPES.md#add-a-plan-schema-migration).

That is also why there are four plan-shaped models
(`backend/models/`): `PlanDocument` (the versioned blob), `Plan` (identity +
lifecycle metadata + document — the API surface), `PlanSummary`
(metadata-only, for cheap listing), and `RawPlanRecord` (metadata +
un-validated dict, the bridge that lets migrations run before validation).

### Circuit validation

`CircuitValidationService` (`backend/core/services/circuit_validation_service.py`)
is pure and read-only, exposed at `GET /api/plans/{id}/validation`. Per
circuit it builds an undirected device graph from the wires and BFSes from the
**sources**: devices reached are *connected*, wired-but-unreachable devices
are *floating* (REQUIREMENTS W4). Load is summed over connected devices only,
with per-device precedence **override → plan `catalog_defaults` → built-in
catalog default** (`DeviceLoadResolver`); `amps = watts / voltage`; status is
`warning` at ≥ 80 % of the breaker rating and `over` above 100 %. It also
reports unassigned powered devices, devices wired into multiple circuits,
dangling wires, and whether any source exists at all (`has_source`,
REQUIREMENTS C1).

A source is any device type whose catalog row is flagged `is_source`
(`backend/models/device_catalog_entry.py`): the electrical panel, plus the
`feed_up` / `feed_down` inter-floor feeds that give a storey with no panel of
its own a connectivity root. The flag is the *only* place the role is defined —
sources root the BFS and are excluded from the connected, floating, unassigned
and multi-circuit findings, so a feed's own `load_w` override never reaches a
circuit sum: it is documentary on this plan. There is no cross-plan link
between floors.

The frontend never calls this endpoint during editing — it mirrors the exact
computation in `frontend/src/utils/circuits.ts` for instant feedback (see
below). The backend remains the source of truth for tests and automation.

### Assets and persistence

`AssetService` + `FileAssetRepository`: underlay images are validated
(JPEG/PNG whitelist, size cap from settings), stored write-once as
`<data_dir>/assets/<uuid>.<ext>` with metadata in an `assets` table, and
served with immutable cache headers. Plans live in a `plans` table with the
JSON document in a TEXT column plus metadata columns (`name`, `revision`,
timestamps, `archived_at`) so listing never parses documents.

### Demo plan and error mapping

`DemoPlanSeeder` (`backend/app/demo_plan_seeder.py`) is a startup task in
the composition root, run from the app lifespan (gated by
`FLOORPLAN_SEED_DEMO_PLAN`): if no plans exist, it uploads
`backend/app/demo/basement_photo.jpg`, splices the resulting asset id into
`basement_demo.json` (replacing the `__DEMO_ASSET__` placeholder), and
creates the demo plan. Any failure is logged and swallowed — seeding must
never block startup.

Domain exceptions map to HTTP in `backend/api/error_handlers.py`: not-found
→ 404, revision conflict / not-archived → 409, oversized asset → 413,
unsupported type → 415. `backend/app/main.py` serves the built SPA
(`frontend/dist`) with an `index.html` fallback for non-`/api` paths.

## Frontend

### Reactivity model: shallow document + version counter

The open document in the editor store (`frontend/src/stores/editor.ts`) is a
`shallowRef<PlanDocument>` — deep-proxying thousands of points would kill the
60 fps target (REQUIREMENTS §10.1). Mutations swap the document wholesale
(new object via structural sharing: only the touched collection and element
are new objects) and bump a `documentVersion` counter. Every derived
`computed` in layers and composables does `void editorStore.documentVersion`
to subscribe to that one cheap signal.

Structural sharing enables the one explicit geometry cache:
`WallsLayer.vue` keeps a module-level `WeakMap<Wall, …>` of serialized
outline paths — an unchanged wall keeps its object identity across mutations,
so its outline is never recomputed (invalidated when the wall or one of its
junction hosts is replaced).

### Geometry pipeline

`frontend/src/utils/geometry/` is a pure, framework-free module (no Vue, no
DOM), re-exported through its `index.ts` barrel. Conventions: units are
inches, y grows down (SVG space), angles in radians. Module map:

| Module | Role |
|---|---|
| `vec.ts`, `lines.ts`, `polygons.ts` | Primitives: vector algebra, line/segment intersection, point projection, even-odd containment, bounds |
| `angles.ts` | The eight allowed 45° directions on global axes + `snapDirection` |
| `wallOutline.ts` | **The core**: `wallFaceOffsets` (reference side → signed face offsets), `offsetPolyline` (mitre joins with bevel fallback), `wallOutline` (input → closed rings) |
| `junctionTrim.ts` | `trimEndpointToHostFace` — slides a T-junction endpoint onto the host wall's near face (render-time only; the stored endpoint stays on the host reference line) |
| `closeLoop.ts` | `autoSquareClose` — solves the final corner of a loop as the intersection of two allowed directions (S1c) |
| `chainEdit.ts` | `setSegmentLength` — exact-dimension edits that propagate through free segments and are blocked by locks, reporting `ok`/`blocked`/`misclosure` (S3b/S3c) |
| `vertexDrag.ts` | Angle-preserving vertex drag candidates (S3) |
| `openings.ts` | Parametric address → jambs, opening rect, door/window symbols; `projectOntoWalls` for placement |
| `devices.ts` | `deviceWorldPlacement` — attachment → world anchor/angle/bounds (+ true-size footprint rect and inscribed-glyph anchor); `deviceGlyphBox`; `deviceScreenScale` (min 14 px legibility clamp); wall-gap measurement for temp dimensions |
| `stairs.ts`, `annotations.ts`, `tempDimensions.ts` | Stairs frame/treads/arrow; dimension-line layout; live face-to-face gap chips (S2a) |
| `wires.ts` | `wireEndpoint` (device id → live world centre), `autoCurveControlPoints`, `wirePathData` (cubic Bézier, Catmull-Rom fallback), sampled hit-testing |

The wall render pipeline, in order (identical in canvas and export):

1. For each stored junction, `trimEndpointToHostFace` adjusts the endpoint so
   the wall butts against its host's face instead of reaching the reference
   line.
2. `wallOutline({vertices, thicknessIn, reference, closed})` offsets both
   faces from the reference line (`offsetPolyline`), joining consecutive
   segments at the intersection of adjacent offset lines (mitre; bevel
   fallback past a 4× mitre limit). Open chains yield one ring with square
   butt caps; closed loops yield two rings rendered as a band.
3. `ringsToPath` (`frontend/src/utils/svgPath.ts`) serializes rings to one
   `M…Z` subpath each, drawn with `fill-rule="evenodd"`.
4. Openings do **not** cut the wall path: `OpeningsLayer.vue` paints a
   background-filled `openingWorldRect` over the wall band, then draws jambs
   and the door/window symbol on top.

### Canvas rendering

`ViewportCanvas.vue` is tool-agnostic: it owns pan/zoom, pointer capture,
grid/rulers, and emits world-coordinate events (`canvas-press`,
`canvas-release`, `canvas-double-click`, `cursor-move`). It provides
`hairline = 1/scale` to slot children so strokes stay ~1 px at any zoom.

Pan/zoom is split in two so both halves are testable without a DOM:

- `useViewport.ts` — pure screen↔world math (`scale = zoom × 2 px/inch`),
  `panByScreen` / `zoomAtPoint` / `fitToRect`, and the SVG root transform.
- `useViewportGestures.ts` — the input layer over it (REQUIREMENTS E5). One
  `PointerGesture` discriminated union (`idle | press | pan`) holds the live
  gesture, so a press and a pan can never overlap: with a mouse every button
  shares one `pointerId`, and independent flags used to leave the pan latched
  on. `classifyWheel` normalises `deltaMode` to pixels, then routes the event
  to zoom or pan per the `ScrollMode` preference (`auto` distinguishes coarse
  wheel notches from continuous trackpad scrolling; `zoom`/`pan` pin it —
  persisted by `useScrollMode.ts`). <kbd>Space</kbd> arms the pan modifier
  only while the pointer is over the canvas, and cancels the keydown so it
  cannot also activate a focused toolbar button.

The canvas suppresses `cursor-move` for the duration of a pan drag — the
world point under the cursor only moves because the camera does — and
re-emits once on release so tool previews resync. Zoom-to-fit is driven by
the host: `EditorPage` measures `planContentBounds` (the same geometry the
SVG export uses) on demand and calls the canvas's `fitTo(rect)`.

The draw stack is composed in `EditorPage.vue`'s template inside the canvas
slot: `UnderlayLayer`, then `StairsLayer → WallsLayer → OpeningsLayer →
ControlLinksLayer → WiresLayer → DevicesLayer → LabelsLayer →
DimensionsLayer`, then the active tool's overlay. Layers read the editor and
layers stores directly (not via props); only `hairline` and tool previews
arrive as props. Devices render as `<use href="#pict-{type}">` against a
`<symbol>` sprite built from the `DEVICE_PICTOGRAMS` registry, counter-scaled
to keep a minimum on-screen size. A type whose catalog row carries a
`DeviceFootprint` (REQUIREMENTS D2) additionally draws its true-size outline
from `deviceWorldPlacement().footprintRect` — real geometry, so never
counter-scaled — with the pictogram inscribed at the rectangle's centre, still
clamped. `length_in`/`depth_in` on the device override that footprint.

Device colour is the circuit's identity (REQUIREMENTS C2/C5). `DevicesLayer`
resolves it once, in `resolveTint`, with a fixed precedence: placement preview
→ selection → circuit colour → ink. The circuit colour comes from
`utils/circuitMembership.ts` (below) and rides on the SVG `color` presentation
attribute, since a per-circuit hex has no Tailwind token and every pictogram
shape strokes with `currentColor`; the theme cases stay Tailwind classes.
Isolation dimming is orthogonal — it only lowers opacity, so a dimmed device
keeps its colour. `stores/layers.ts` can hide a circuit's devices independently
of its wires (C6): a device drops out once EVERY circuit it belongs to is
device-hidden, while devices on no circuit and the sources always render.

### Export

`frontend/src/export/svgExport.ts` builds the export **as a string** — it
does not serialize the live DOM or re-render components. `buildPlanSvg`
calls the same geometry functions as the layers and concatenates elements
into named groups (`#underlay`, `#structure`, `#devices`,
`#circuit-<slug>`, `#annotations`) with real-inch coordinates, so the file is
layer-editable in Inkscape/Illustrator (X2). Colours and stroke widths come
from constants in `exportTheme.ts` (kept in sync with the Tailwind theme)
instead of CSS — except device colours, which run through the same
`deviceCircuitColor` rule the canvas uses (falling back to `EXPORT_INK`), so a
printed device reads as the circuit it shows on screen. `pngExport.ts`
rasterizes that same SVG string on an offscreen canvas (capped ~16 MP), and
`jsonExport.ts` round-trips the raw `PlanDocument` — so all three exports share
one geometry source.

### Editor store: commands, undo/redo, transactions

All document changes flow through `editorStore.mutate(command)`.
`EditorCommand` is a discriminated union — `setViewport`, `setUnderlay`, and
`add/update/remove` per element kind. `mutate` applies cascade rules as a
single transaction (removing a wall removes its openings and attached
devices; removing a device removes its wires and control links; removing a
circuit removes its wires).

Undo/redo is **command-based with inverses computed at apply time** (not
snapshots): each history entry stores the applied commands and their
inverses; undo replays inverses in reverse. History is capped at 100 entries
(spec E3). `beginTransaction`/`commitTransaction` coalesce a gesture (e.g. a
drag's stream of `update*` commands collapses to the final one) into one
undo step; `abortTransaction` replays inverses immediately (used by Esc).
Viewport changes are saved but never recorded in history — plan-settings
commands (`setThicknessPresets`, `setDisplayPrecision`, `setPresetList`)
follow the same pattern.

`setPresetList` generalizes the wall-thickness-presets idea to any named,
per-plan option-button list (spec §5.9 tier 2):
`frontend/src/utils/presetLists.ts` resolves a list's effective values
(`resolve`, falling back to built-in defaults when the document has no entry
for that name) and grows it with a newly committed value (`withValue` —
ascending, de-duplicated within a small tolerance, capped at
`MAX_PRESET_LIST_SIZE` by dropping the entry farthest from the new one).
`OpeningToolOptions.vue` and `StairsToolOptions.vue` call it whenever a typed
custom width isn't already a preset.

Selection is a `Map<'kind:id', ElementRef>` in the same store, pruned
automatically when elements disappear. The store also holds the circuit
editing session (`activeCircuitId`, `isolatedCircuitId`) and the device
clipboard. The **active tool is not store state** — it lives in
`EditorPage.vue`.

### Autosave

Also in the editor store: every mutation schedules a debounced save (2 s).
`saveNow` PUTs `{revision, document}`; success adopts the server's
incremented revision; a 409 means the plan changed elsewhere — the store
re-fetches, adopts the server version, and surfaces "This plan was modified
elsewhere…" via `saveState`/`saveError`, which `EditorTopBar.vue` renders as
the saved/saving indicator. `flushPendingSave()` runs on page unmount so
navigating away never loses the tail edit. Re-entrancy is handled with a
dirty flag: edits made mid-save trigger a follow-up save.

### Tool system

Three pieces:

1. **Registry** — `frontend/src/components/editor/tools.ts` defines `ToolId`
   and the ordered `TOOLS` array (name, single-key shortcut, Lucide icon).
   `ToolRail.vue` renders it; `ShortcutOverlay.vue` derives its listing from
   it; `useToolShortcuts` binds the keys (ignoring typing targets and keys
   claimed by an active tool's input buffer).
2. **Headless composables** — one per tool
   (`frontend/src/composables/use<Tool>Tool.ts`). Each is a pure state
   machine: it receives reactive inputs (walls, snap settings,
   pixels-per-inch) and a `commit` callback, and exposes a conventional
   interface — `setCursor`, `onClick`/`onPress`/`onRelease`,
   `handleKey(key): boolean`, `setAlt`, `deactivate`, and a computed
   `preview`. Tools never touch the store; `commit` is wired to
   `editorStore.mutate` by the page. (`useSelectTool` is the exception — it
   drives drags/transactions through a narrow `SelectToolStore` interface.)
3. **Composition root** — `frontend/src/pages/EditorPage.vue` instantiates
   every tool, holds `activeTool`, and dispatches canvas events to the active
   composable (`switch (activeTool.value)` in `handleCanvasPress` etc.).
   Previews flow back out as computed props into overlay components
   (`WallToolOverlay.vue`, `DeviceToolOverlay.vue`, `SelectionOverlay.vue`)
   rendered in the canvas slot.

The full add-a-tool checklist is in
[RECIPES.md](RECIPES.md#add-an-editor-tool).

### Snapping and typed input

`useSnapping` is the shared snap engine (pure): priority is chain-close →
wall endpoint → wall midpoint → projection onto a wall reference line
(producing the attachment used for T-junctions) → 45° angle constraint →
grid (3″ step, 10 px threshold). Alt disables only angle + grid. Results
carry a marker kind and optional guide ray that tools pass through their
previews so overlays can visualize the snap *before* the click (E6). Snap
toggles persist to `localStorage` via `useSnapSettings`.

Typed exact input ("the keyboard is the tape measure"): tools with length
input keep an `inputBuffer` ref fed by `handleKey` (chars matching
`isBufferKey` — digits, `'`, `"`, `/`, `.`, space), parsed by
`parseFeetInches` (`frontend/src/utils/units.ts`) on Enter. `EditorPage`
aggregates the active tool's buffer into the status bar echo
(`EditorStatusBar.vue`).

### Client-side circuit validation

`frontend/src/utils/circuits.ts` mirrors the backend service exactly — same
BFS connectivity from the sources (`isSourceType`, the client's copy of the
`is_source` catalog flag), same load precedence, same 80 % warning
threshold — and `useCircuitValidation` recomputes it per `documentVersion`
tick. It feeds the Circuits panel rows, the warning badge count, and circuit
isolation highlighting. If you change validation logic, change **both**
implementations (and their tests: `tests/core/services/` and
`frontend/tests/utils/circuits.test.ts`). `tests/fixtures/circuit_validation/`
is the cross-language contract: each JSON fixture holds a document and its
expected `PlanValidation`, and both
`test_circuit_validation_service.py::test_validate__against_shared_corpus__matches_expected_result`
and `frontend/tests/utils/circuitsCorpus.test.ts` parametrize over every file
in that directory, so a rule added to only one implementation fails the other
suite. Add a new fixture whenever you add a rule to either side.

Everything that needs the reverse mapping — device → its circuits — reads it
from `frontend/src/utils/circuitMembership.ts`, a deliberate sibling of the
pinned mirror rather than an addition to it: `circuitsByDevice(validation,
circuits)` only *consumes* a `PlanValidation`, inverting the per-circuit
`connected_device_ids`/`floating_device_ids` into a device-major map in document
order (a floating device IS on its circuit — the panel's amber warning is what
says it does not reach a source). `deviceCircuitColor(device, membership)` is
the one colour rule the canvas and the SVG export share: first circuit in
document order, `null` for a source or a device on no circuit.

### Stores overview

| Store | Scope |
|---|---|
| `stores/editor.ts` | The open plan: document, history, selection, autosave, circuit session, clipboard |
| `stores/plans.ts` | Home-page plan list (summaries, CRUD, thumbnail document cache, JSON import) |
| `stores/layers.ts` | Session-only layer visibility (structure/devices/annotations booleans + the hidden-circuit id set per axis, wires and devices) |
| `stores/deviceMru.ts` | Most-recently-used device types for the picker (`localStorage`, capped at 6) |

## Testing

Backend tests (`tests/`, pytest, `asyncio_mode = "auto"`) mirror the source
layout. API tests run the real app over `httpx.AsyncClient` +
`ASGITransport` with the DB pointed at `tmp_path` via
`FLOORPLAN_DB_PATH`; repository tests use real SQLite files; service tests
mock repositories with `AsyncMock(spec=...)`.

Frontend tests (`frontend/tests/`, Vitest) focus on composables, stores,
utils and export, with a shared `tests/helpers/planFactory.ts`.

Two **parity guards** are worth knowing about, since they fail on purpose
when the two sides of a contract drift:

- `tests/models/test_device_type.py` and
  `frontend/tests/devices/catalog.test.ts` both assert the device-type count
  (currently 15) and full catalog coverage — adding a device type on one side
  only fails the other side's test.
- `frontend/tests/utils/circuits.test.ts` covers the client-side mirror of
  the backend validation semantics.
