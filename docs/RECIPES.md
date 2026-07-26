# Recipes

Step-by-step guides for the recurring extension tasks the architecture was
designed to make routine. Read [ARCHITECTURE.md](ARCHITECTURE.md) first for
the concepts each recipe leans on. Finish every recipe with `poe check` and
`cd frontend && npm run lint && npm run test`.

## Add a device type

The catalog is data-driven (REQUIREMENTS D5): a plain new device type is
pure registry data — no service, resolver, migrator or component changes.
The type id must be **identical** in every registry; parity tests on both
sides enforce it.

1. **Backend registry** — `backend/models/device_type.py`: add the member to
   the `DeviceType` enum and its row to `DEVICE_CATALOG` (`mount`:
   wall/ceiling/free, `voltage_v` or `None`, `default_load_w`, plus
   `is_source=True` if the type is a circuit source — see below).
2. **Frontend type** — `frontend/src/types/plan.ts`: add the same string to
   the `DeviceType` union.
3. **Frontend catalog** — `frontend/src/devices/catalog.ts`: add the type to
   the ordered `DEVICE_TYPES` array (this fixes its position in the picker)
   and to `DEVICE_CATALOG` (label, `legendFr`, mount, voltage, default load,
   `searchTerms` for the picker, plus an optional `footprint` in inches when the
   type has a real size — see REQUIREMENTS D2; omit it for a symbolic type).
4. **Pictogram** — `frontend/src/devices/pictograms.ts`: add a
   `DEVICE_PICTOGRAMS` entry — a list of shapes in the 12×12 box, consistent
   with common electrical-plan symbols. The renderers
   (`DevicePictogram.vue`, `DeviceGlyph.vue`, `DevicePicker.vue`) and the SVG
   export iterate the registries, so no component changes are needed.
5. **Tests** — update the two parity guards:
   `tests/models/test_device_type.py` (member count + catalog coverage) and
   `frontend/tests/devices/catalog.test.ts` (`BACKEND_TYPES` array + count).

Only step outside the registries when the type needs *behavior*, not just a
symbol. Neither of the two roles a type can carry is such a case: a `footprint`
on the catalog row is enough for `utils/geometry/devices.ts` to draw and
hit-test the type at true scale and for the Inspector and tool options to
expose its dimensions, and `is_source` on both catalog rows is enough to make
the type a connectivity root everywhere (`circuit_validation_service.py`,
`utils/circuits.ts`, `EditorPage.vue` all read the flag). A new source type
also wants a fixture in `tests/fixtures/circuit_validation/`.

## Add a plan schema migration

Needed whenever `PlanDocument` gains, renames or restructures a field.
Documents are migrated lazily on read, one version at a time; old versions
are never rejected and a pre-migration copy is kept automatically
(`document_backups` table), so a migration is cheap insurance — write one
even for additive changes.

1. **Bump the version** — `backend/constants.py`: increment
   `CURRENT_SCHEMA_VERSION` (say 5 → 6).
2. **Write the step** — `backend/core/plan_migrator.py`: add a
   `_migrate_v5_to_v6(document)` staticmethod. Work on the raw dict,
   `setdefault` new fields (documents may predate any optional field), and
   set `document["schema_version"] = 6` at the end.
3. **Register it** — in `PlanMigrator.__init__`, add `5: self._migrate_v5_to_v6`
   to `self._steps`.
4. **Update the model** — `backend/models/plan_document.py`: add the field
   **with a default**. Every `PlanDocument` field must have one so older
   client payloads still validate during the autosave window where the SPA
   is outdated.
5. **Mirror the frontend** — `frontend/src/types/plan.ts`: add the field to
   the `PlanDocument` interface, and initialize it wherever new documents or
   elements are built (check `stores/editor.ts` and
   `frontend/tests/helpers/planFactory.ts`).
6. **Tests** — `tests/core/test_plan_migrator.py`: add a `_v5_document()`
   builder and a test walking v5 → v6; the existing older-version tests
   already assert the walk ends at `CURRENT_SCHEMA_VERSION`, so they cover
   the new step transitively.
7. **Demo plan** — `backend/app/demo/basement_demo.json` is a version-5 document;
   it migrates on first read, so it only needs regenerating if you want it
   to exercise the new field.

Never write a step that drops or rewrites user data destructively — if a
field's meaning changes, keep the old value recoverable in the new shape.
Downgrades don't exist: a document newer than the backend raises
`UnsupportedSchemaVersionError`.

## Add an editor tool

Tools are headless state machines wired together in `EditorPage.vue`; the
canvas only emits world-coordinate pointer events. Skim an existing tool
first — `useDimensionTool.ts` (two-click) or `useStairsTool.ts`
(press-drag-release) are the smallest templates.

1. **Registry** — `frontend/src/components/editor/tools.ts`: add the id to
   `ToolId` and an entry to `TOOLS` (name, unique lowercase shortcut, Lucide
   icon, `enabled: true`). The tool rail, tooltips and the `?` shortcut
   overlay all derive from this.
2. **Composable** — `frontend/src/composables/useFooTool.ts`: follow the
   conventional interface — options carry reactive inputs (walls, snapping,
   `pixelsPerInch`) plus a `commit` callback; return a computed `preview`,
   `setCursor`, `onClick` (or `onPress`/`onRelease`), `handleKey(key)`
   returning `true` when consumed, `setAlt` if Alt-sensitive, and
   `deactivate`. Keep it pure: no store imports, no DOM.
3. **Wire it in `frontend/src/pages/EditorPage.vue`** — the bulk of the work:
   - instantiate it with `commit: x => editorStore.mutate({ type: …, … })`;
   - dispatch in `handleCanvasPress` (and release/double-click if used) and
     fan out `setCursor` in `handleCursorMove`;
   - route keys in `handleActiveToolKey`, and Alt in `setAltEverywhere`;
   - call `deactivate` + reset in the `watch(activeTool, …)`;
   - if it takes typed lengths, include its `inputBuffer` in the
     `statusInputBuffer` computed and claim its keys in the `suppress`
     callback of `useToolShortcuts`;
   - render its overlay in the `ViewportCanvas` slot behind a
     `v-if="activeTool === 'foo'"` guard.
4. **Overlay component** — `frontend/src/components/editor/FooToolOverlay.vue`
   (if the tool draws a preview): an SVG `<g>` consuming the `preview` prop
   and `hairline`, including snap markers/guides so the outcome is visible
   before the click (E6).
5. **Side panel** — `frontend/src/components/editor/EditorSidePanel.vue`: add
   a `TOOL_HINTS` entry (placement hint text) and, if the tool has options,
   an options/inspector component and its template branch.
6. **Only if the tool creates a new element type** — extend the document and
   command machinery:
   - `frontend/src/types/plan.ts`: element interface + `PlanDocument` field —
     this changes the schema, so follow
     [Add a plan schema migration](#add-a-plan-schema-migration) too;
   - `frontend/src/stores/editor.ts`: `add/update/removeFoo` variants in
     `EditorCommand`, handled in `applyCommand`, `invertCommand` and
     `updateKeyOf`; selection kind + `pruneSelection` if selectable; cascade
     rules in `mutate` if other elements can reference it;
   - a layer component to render it, plus hit-testing in `useSelectTool.ts`
     and export support in `frontend/src/export/svgExport.ts`;
   - geometry helpers go in `frontend/src/utils/geometry/` as pure functions.
7. **Tests** — `frontend/tests/composables/useFooTool.test.ts` driving the
   composable headlessly (see `useWireTool.test.ts` for the pattern:
   construct with plain refs, call `setCursor`/`onClick`, assert commits).
