# Interactive Tutorial — Design Spec

Status: **proposed, not yet built.** A hands-on, in-editor tutorial that
teaches the drawing workflow by having the user actually perform it on a
practice plan, with each step verified against real editor state. Companion
to [REQUIREMENTS.md](REQUIREMENTS.md) (same conventions) and
[ARCHITECTURE.md](ARCHITECTURE.md) (the machinery this builds on).

---

## 1. Goals and non-goals

**Goals**

- Teach the skills that are genuinely hard to discover: typed exact input,
  the lock-and-type dimensioning workflow, reference sides, calibration,
  wiring circuits.
- Verify by observing outcomes, not clicks: a step completes when the
  document or editor state proves the user did the thing.
- Respect the app's own UX principles (REQUIREMENTS §6.2): docked, quiet,
  never modal, never blocking — the user can ignore or leave the tutorial at
  any moment and every editor feature keeps working.
- Zero backend changes.

**Non-goals**

- Forced onboarding or auto-starting on first run (the demo plan remains the
  first-run showcase).
- Video, animation of the "correct" gesture, or telemetry/analytics.
- Localization framework (copy is English for now, like the rest of the UI).
- Teaching every feature — the tutorial covers the spine of the workflow;
  the `?` shortcut overlay and tool hints remain the reference for the rest.

## 2. Why this approach works here

Two properties of the existing architecture do most of the work:

1. **Every mutation is a semantic event.** All edits flow through
   `editorStore.mutate(command)` as typed `EditorCommand`s. The tutorial
   engine subscribes to that stream (plus `activeTool` and the live
   validation) instead of instrumenting UI components.
2. **Documents are immutable snapshots.** Each mutation swaps the document
   object (structural sharing). The engine can retain the document reference
   from the moment a step began (`entryDocument`) for free, and completion
   predicates become cheap pure diffs: "one more door than when this step
   started".

Consequently steps are *outcome-based*: "make a wall exactly 10 feet" is
satisfied by a segment measuring 120.00" no matter whether the user typed
`10'` or snapped there — which is the correct teaching semantics.

## 3. UX

### 3.1 Entry points

- **Home page** (`PlansHomePage.vue`): a persistent "Learn the editor"
  card alongside the plan cards (est. 10–15 min, shows progress if started).
  Starting creates (or reopens) the practice plan and opens the editor with
  the tutorial panel visible.
- **Shortcut overlay** (`ShortcutOverlay.vue`): a "(Re)start the tutorial"
  link.
- Never auto-starts. Dismissing is one click and remembered.

### 3.2 The tutorial panel

A collapsible card docked **above the tab strip** of the right panel
(`EditorSidePanel.vue`) — not a fourth tab, because steps routinely direct
the user *into* the Inspector/Circuits/Layers tabs, which must stay usable
while the instructions remain visible. Contents:

- Chapter title + overall progress bar (thin, quiet).
- The current step: title, short body (may embed `<kbd>` keys), and its
  state (pending → checkmark on completion, with a subtle transition;
  respects `prefers-reduced-motion`).
- Controls: **Skip step**, **Back**, and an overflow menu with **Skip
  chapter**, **Restart tutorial**, **Exit** (exit hides the panel; progress
  is kept).

Accessibility: the card is a `section aria-label="Tutorial"`; step
completions are announced via a polite `aria-live` region.

### 3.3 Anchors (visual pointers)

A step may declare one anchor; the UI shows a subtle pulsing ring on it
while the step is active. Anchor kinds: a tool-rail button (`ToolId`), a
side-panel tab, a top-bar item (undo/export), or the status bar (for typed
input steps). No floating callouts, no arrows across the canvas.

### 3.4 Functional requirements

- **L1** — The tutorial runs on a dedicated practice plan created from a
  bundled starter document; it never touches the user's other plans.
- **L2** — Steps complete only through real editor actions, evaluated from
  state; already-satisfied steps auto-complete when reached (doing work
  ahead of the script is never punished).
- **L3** — Completion is monotonic: undo after completing a step does not
  un-complete it.
- **L4** — Progress persists (Tier-1 app preference, `localStorage`) across
  sessions; reopening the practice plan resumes where the user left off.
- **L5** — Opening a different plan pauses the tutorial (panel hidden); no
  tutorial state ever leaks into other plans.
- **L6** — If the practice plan was deleted, the entry points offer a clean
  restart (fresh practice plan, progress reset).
- **L7** — The tutorial is purely observational: it never performs actions
  for the user, never locks tools, never intercepts input.

## 4. Content — chapters and steps

Step kinds: `task` (has a completion predicate) and `info` (read + Next).
Predicates below are abbreviated TypeScript over the `TutorialContext`
(§5.2); `entry` refers to the step's `entryDocument`. `EPS = 0.01"` for
exact-length checks.

### Chapter 1 — Get around the canvas

| # | Kind | Step | Completion |
|---|---|---|---|
| 1 | info | Welcome; what this panel is; you can leave anytime | — |
| 2 | task | Pan the canvas (space-drag, middle-drag or two-finger scroll) | `doc.viewport.center ≠ entry.viewport.center` |
| 3 | task | Zoom with the wheel or a pinch | `doc.viewport.zoom ≠ entry.viewport.zoom` |
| 4 | task | Zoom to fit (top bar or shortcut) | ui event `zoom-fit` |

### Chapter 2 — Draw walls

| # | Kind | Step | Completion |
|---|---|---|---|
| 1 | task | Activate the Wall tool (<kbd>W</kbd>) — anchor: tool rail | `activeTool === 'wall'` |
| 2 | task | Click out a chain of at least 3 segments | `doc.walls.some(w => w.vertices.length >= 4)` |
| 3 | task | Type an exact length: make a segment exactly 10' — anchor: status bar | `someSegment(doc, len => abs(len - 120) < EPS)` |
| 4 | task | Close a loop (click the ring at the start vertex) | `doc.walls.some(w => w.closed)` |
| 5 | info | Reference sides (<kbd>Tab</kbd> while drawing), thickness presets in the Inspector | — |

### Chapter 3 — True-up with the tape measure

| # | Kind | Step | Completion |
|---|---|---|---|
| 1 | info | The workflow: trace roughly, then walk the loop — type the measurement, lock, repeat | — |
| 2 | task | Select a wall segment (Select tool, <kbd>V</kbd>) | `editor.selectedWallIds.size > 0` |
| 3 | task | Set its exact length from the Inspector: make it 12' | `someSegment(doc, len => abs(len - 144) < EPS)` |
| 4 | task | Lock that segment (padlock in the Inspector) | `doc.walls.some(w => w.locked_segments.length > 0)` |
| 5 | task | Made a mistake? Undo it (<kbd>Ctrl+Z</kbd>) — anchor: top bar | event `undo` |

### Chapter 4 — Doors, windows, stairs

| # | Kind | Step | Completion |
|---|---|---|---|
| 1 | task | Place a door on a wall (<kbd>D</kbd>) | `count(doc.openings, 'door') > count(entry.openings, 'door')` |
| 2 | task | Change its width to 30" in the Inspector | `doc.openings.some(o => o.kind === 'door' && o.width_in === 30)` |
| 3 | task | Place a window (<kbd>N</kbd>) and a stair run (<kbd>S</kbd>) | window count and `doc.stairs.length` both `> entry` |

### Chapter 5 — Trace a photo *(optional chapter — skippable as a whole)*

The practice plan ships with a bundled practice photo as its underlay,
deliberately mis-calibrated and tilted a few degrees, with a marked 10'
reference wall.

| # | Kind | Step | Completion |
|---|---|---|---|
| 1 | info | What an underlay is; ours is out of scale and tilted on purpose | — |
| 2 | task | Straighten it: select the underlay (<kbd>V</kbd>) and drag its round rotation handle, or type `0` in the Rotation field (Layers tab) — anchor: Layers tab | `abs(doc.underlay.transform.rotation_deg) < 0.5` |
| 3 | task | Calibrate (<kbd>C</kbd>): trace the marked reference and type `10'` | `abs(doc.underlay.transform.scale - KNOWN_SCALE) / KNOWN_SCALE < 0.02` |
| 4 | task | Adjust the underlay opacity in the Inspector | `doc.underlay.opacity ≠ entry.underlay.opacity` |

### Chapter 6 — Electrical devices

| # | Kind | Step | Completion |
|---|---|---|---|
| 1 | task | Place a duplex outlet on a wall (<kbd>E</kbd>, pick from the palette) | `doc.devices.some(d => d.type === 'outlet' && d.attachment)` |
| 2 | task | Place a ceiling light anywhere | `doc.devices.some(d => d.type === 'ceiling_light')` |
| 3 | task | Get three outlets on one wall — tip: <kbd>Ctrl+D</kbd> duplicates | `maxOutletsOnOneWall(doc) >= 3` |
| 4 | task | Place a baseboard heater and set it to 750 W in the Inspector | `doc.devices.some(d => d.type === 'baseboard_heater' && d.load_w === 750)` |

### Chapter 7 — Circuits and wires

| # | Kind | Step | Completion |
|---|---|---|---|
| 1 | task | Place the electrical panel | `doc.devices.some(d => d.type === 'panel')` |
| 2 | task | Create a circuit in the Circuits tab (pick a colour, 15 A) — anchor: Circuits tab | `doc.circuits.length > entry.circuits.length` |
| 3 | task | Wire the panel to an outlet (<kbd>R</kbd>) | `validation.circuit_loads.some(c => c.connected_device_ids.length >= 1)` |
| 4 | task | Daisy-chain a second outlet | `...connected_device_ids.length >= 2` |
| 5 | task | Overload it: wire the baseboard in and watch the load bar warn | `validation.circuit_loads.some(c => c.status !== 'ok')` |
| 6 | task | Isolate the circuit (click it in the Circuits tab) | `editor.isolatedCircuitId !== null` |

### Chapter 8 — Save and export

| # | Kind | Step | Completion |
|---|---|---|---|
| 1 | info | Autosave: you never press save — anchor: top-bar indicator | — |
| 2 | task | Export the plan as SVG — anchor: export button | ui event `export-completed` |
| 3 | info | Done! Where to go next: `?` overlay, the demo plan. Archive this practice plan whenever you like | — |

≈ 29 steps, 10–15 minutes.

## 5. Technical design

All frontend. New module `frontend/src/tutorial/`, one composable, one
component, one observer hook in the editor store.

### 5.1 Step schema — `frontend/src/tutorial/steps.ts`

```ts
type TutorialAnchor =
  | { kind: 'tool'; tool: ToolId }
  | { kind: 'tab'; tab: 'inspector' | 'circuits' | 'layers' }
  | { kind: 'topbar'; item: 'undo' | 'export' | 'save-indicator' }
  | { kind: 'statusbar' }

interface TutorialStep {
  id: string                    // stable, e.g. 'walls.exact-length'
  kind: 'task' | 'info'
  title: string
  body: string                  // short HTML fragment; <kbd> allowed
  anchor?: TutorialAnchor
  isComplete?: (ctx: TutorialContext) => boolean   // required when kind === 'task'
}

interface TutorialChapter {
  id: string
  title: string
  optional?: boolean            // chapter-level skip affordance (ch. 5)
  steps: TutorialStep[]
}

export const TUTORIAL_CHAPTERS: readonly TutorialChapter[]
```

Data-driven like the device catalog: adding a chapter is adding data.
Predicates must be pure, synchronous and cheap — they run on every
document tick while their step is active (§5.3).

### 5.2 Context

```ts
interface TutorialContext {
  document: PlanDocument         // current snapshot
  entryDocument: PlanDocument    // snapshot retained when the step became active (free: immutable)
  activeTool: ToolId
  validation: PlanValidation     // from useCircuitValidation
  editor: {
    selectedWallIds: ReadonlySet<string>
    activeCircuitId: string | null
    isolatedCircuitId: string | null
  }
  lastEvent: TutorialEvent | null
}

type TutorialEvent =
  | { type: 'command'; command: EditorCommand }
  | { type: 'undo' } | { type: 'redo' }
  | { type: 'ui'; name: 'zoom-fit' | 'export-completed' }
```

Shared predicate helpers (`someSegment`, collection counters,
`maxOutletsOnOneWall`) live beside the steps and are unit-tested directly.

### 5.3 Engine — `frontend/src/composables/useTutorial.ts`

- Instantiated in `EditorPage.vue`; active only when the open plan id equals
  the stored practice-plan id (L5).
- Re-evaluates the active step's predicate on: editor events (via the store
  hook, §5.4), `documentVersion` change, `activeTool` change, and ui events.
- On step entry: retain `entryDocument`, then evaluate once immediately
  (auto-complete, L2). On completion: brief completed state, then advance.
- Completion is recorded by step id and never revoked (L3).
- Exposes to the page/panel: `activeChapter`, `activeStep`, `progress`,
  `completedStepIds`, `skipStep`, `skipChapter`, `back`, `restart`, `exit`,
  and `notifyUi(event)`.

### 5.4 Editor store hook

One additive change to `frontend/src/stores/editor.ts`:

```ts
function onEditorEvent(listener: (e: TutorialEvent) => void): () => void
```

Emitted after `applySingle` (with the command), and after `undo`/`redo`.
No behavioral change to the store; the tutorial is a pure observer (L7).
`notifyUi` covers the two things invisible to the command stream (zoom-fit,
export completion — emitted from the existing `EditorPage.vue` /
`ExportDialog.vue` handlers).

### 5.5 Practice plan — `frontend/src/tutorial/practicePlan.ts`

- A bundled starter `PlanDocument` (current `schema_version`): empty
  geometry, the mis-calibrated underlay transform (wrong scale, tilted a
  few degrees), sensible viewport.
- The practice photo is a small bundled raster (a clean line drawing with a
  marked 10' wall, ~100–200 KB, lives in `frontend/src/assets/`). On start,
  it is uploaded through the existing `POST /api/assets` and its id spliced
  into the starter document — the client-side mirror of what
  `DemoPlanSeeder` does on the backend.
- Plan creation reuses `plansStore.importPlan(name, document)`; name:
  `"Tutorial — practice plan"`. `KNOWN_SCALE` (the correct calibration for
  chapter 5's predicate) is a constant exported next to the document.

### 5.6 Persistence

`localStorage` key `floorplan.tutorial.v1`:

```ts
{ planId: string; completed: string[]; current: string; dismissed: boolean }
```

Step ids are the durable identity — reordering or inserting steps in a
later release keeps old progress meaningful. Corrupt/missing state degrades
to "not started".

### 5.7 UI components

- `frontend/src/components/editor/TutorialPanel.vue` — the docked card
  (§3.2). Props in, events out; no store access beyond the composable's
  returns.
- Anchor highlighting: the page computes the active anchor; `ToolRail.vue`,
  `EditorSidePanel.vue` and `EditorTopBar.vue` accept an optional
  `highlight` prop and render the pulse ring class. No new positioning
  logic, no portals.
- Home-page entry card in `PlansHomePage.vue`.

## 6. Edge cases

- **Practice plan deleted** → entry points detect the dangling `planId` and
  offer a fresh start (L6).
- **Working ahead / out of order** → auto-complete on step entry (L2); the
  engine never forces sequence, only presents it.
- **409 conflict reload** → the document object is replaced wholesale;
  predicates are state-based, so evaluation just continues (event-based
  steps — undo, ui events — are unaffected).
- **Schema migration** of the bundled starter document: it declares the
  current `schema_version` at build time; if opened by a newer app it
  migrates like any plan.

## 7. Testing

- `frontend/tests/tutorial/steps.test.ts` — every task predicate exercised
  positively and negatively against documents built with
  `tests/helpers/planFactory.ts`. This is the bulk of the value: predicates
  are pure functions.
- `frontend/tests/tutorial/useTutorial.test.ts` — engine behavior: entry
  auto-complete, monotonic completion, skip/back/restart, persistence
  round-trip, pause on foreign plan.
- Component test for `TutorialPanel.vue` limited to user-visible behavior
  (renders step, emits skip/exit).

## 8. Milestones

1. **T1 Engine + core drawing** — store hook, engine, panel, persistence,
   chapters 1–3. The tutorial is releasable at this point.
2. **T2 Structure & devices** — chapters 4–6, practice photo asset and
   upload-on-start.
3. **T3 Circuits, export, polish** — chapters 7–8, anchors on all steps,
   a11y pass, home-page card polish.

Each milestone ends with `poe check` and frontend lint/tests green.
