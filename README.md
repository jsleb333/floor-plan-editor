# Floor Plan Editor

Interactive web editor for residential floor plans and their electrical
layout. The reference use case is digitizing a hand-drawn basement plan:
import a photo, calibrate its scale, trace the walls, place electrical
devices, and wire them into colour-coded circuits fed from the electrical
panel — with real dimensions (feet and inches) and real electrical loads
tracked against breaker ratings.

Single-user, locally hosted. See [REQUIREMENTS.md](REQUIREMENTS.md) for the
full requirements, data model and design rationale.

## Features

- **Underlay tracing** — import a JPEG/PNG of a hand-drawn plan, calibrate it
  against a known length, and trace over it at adjustable opacity.
- **Parametric walls** — walls are reference polylines with thickness and
  reference side (centre/left/right); corners mitre exactly, junctions stay
  attached, and typed lengths (`12'6`, `9'0 1/8`) place vertices precisely.
  Per-segment locks let you walk a traced loop with tape measurements and
  push corrections into the still-free walls.
- **Openings, stairs, labels, dimensions** — doors with swing arcs, windows,
  stair runs, room labels, and live-updating dimension annotations.
- **Electrical devices** — a searchable catalog of pictograms (outlets,
  switches, lights, baseboard heaters, panel...). Wall-mounted devices attach
  parametrically to walls and follow them when geometry changes.
- **Circuits and wires** — hand-routed Bézier wires between devices, grouped
  into colour-coded circuits. Per-circuit load tracking (watts and amps
  against the breaker rating, warning above 80 %), floating-device detection,
  highlight/isolate per circuit.
- **Editor UX** — snapping with visual feedback (grid, angles, walls),
  undo/redo, keyboard-first tools with single-key shortcuts, layers panel,
  autosave with optimistic concurrency.
- **Export** — SVG (layered, real-unit coordinates), PNG, and lossless JSON.
- **Demo plan** — a digitized version of the bundled hand-drawn basement plan
  is installed on first run as a showcase.

## Stack

- **Backend**: Python 3.13+, FastAPI, Pydantic v2, SQLite (aiosqlite),
  dishka for dependency injection. Hexagonal architecture (ports & adapters).
- **Frontend**: Vue 3 (Composition API) SPA with TypeScript, Vite, Pinia,
  Tailwind CSS 4. Rendering is a single SVG viewport — the same geometry code
  drives editing and export.

## Getting started

### Prerequisites

- [uv](https://docs.astral.sh/uv/) with Python 3.13+
- Node.js 20.19+ (for Vite 7)

### Install

```bash
uv sync --group dev          # backend dependencies + dev tooling
cd frontend && npm install   # frontend dependencies
```

### Run (development)

Two dev servers, in separate terminals:

```bash
poe api --dev    # backend on http://127.0.0.1:47825 with auto-reload
poe ui           # frontend on http://localhost:5173 (proxies /api to the backend)
```

Open <http://localhost:5173>. On first run the backend seeds the demo
basement plan.

### Run (production)

Build the SPA, then let the backend serve it:

```bash
cd frontend && npm run build   # outputs frontend/dist
poe api                        # serves API + SPA on http://127.0.0.1:47825
```

## Configuration

Settings are loaded from environment variables prefixed with `FLOORPLAN_`
(see [backend/settings.py](backend/settings.py)):

| Variable | Default | Purpose |
|---|---|---|
| `FLOORPLAN_DATA_DIR` | `data` | Directory for stored assets (underlay images) |
| `FLOORPLAN_DB_PATH` | `data/floor_plan.db` | SQLite database file |
| `FLOORPLAN_FRONTEND_DIST` | `frontend/dist` | Built SPA to serve in production |
| `FLOORPLAN_MAX_ASSET_SIZE_BYTES` | `31457280` (30 MiB) | Upload size limit for underlay images |
| `FLOORPLAN_SEED_DEMO_PLAN` | `true` | Install the demo plan when the database is empty |

## Development

### Commands

```bash
poe check        # lint + typecheck + test (run before committing)
poe lint         # ruff check
poe format       # ruff format
poe typecheck    # ty check
poe test         # pytest

cd frontend
npm run lint     # eslint
npm run format   # prettier
npm run test     # vitest
npm run build    # type-check (vue-tsc) + production build
```

### Project structure

```
backend/
  api/           # FastAPI routes (thin) + Pydantic schemas
  core/          # Business logic: services, orchestrators, plan migration
  interfaces/    # ABC interfaces (ports)
  models/        # Pydantic domain + persistence models
  infra/         # Adapters: SQLite plan repository, file asset repository
  demo/          # Bundled demo plan document + underlay photo
  container.py   # Dishka wiring (infra -> services -> orchestrators)
  main.py        # App factory (serves the built SPA in prod)

frontend/src/
  api/           # Fetch client, one module per domain
  types/         # TypeScript domain types mirroring backend schemas
  pages/         # Route-level components (plans home, editor)
  components/    # Editor canvas layers, tool overlays, panels, inspectors
  composables/   # Editor behaviours (viewport, snapping, tools, validation)
  stores/        # Pinia stores (plans, editor, layers)
  utils/         # Pure utilities, incl. the shared geometry module
  export/        # SVG / PNG / JSON export
  devices/       # Device catalog + pictogram registry

tests/           # Backend tests (pytest), mirroring backend/ layout
frontend/tests/  # Frontend tests (vitest), mirroring frontend/src/ layout
```

Architecture conventions (hexagonal layering, DI rules, code style) are
documented in [.claude/CLAUDE.md](.claude/CLAUDE.md).

### API surface

The REST API doubles as the app's automation surface (fixtures, integration
tests, programmatic plan generation). All routes are under `/api`;
interactive docs at `/docs` when the backend is running.

| Method & path | Purpose |
|---|---|
| `GET /api/plans` | List plans (metadata summaries) |
| `POST /api/plans` | Create a plan |
| `GET /api/plans/{id}` | Full plan document |
| `PUT /api/plans/{id}` | Replace document (autosave; optimistic concurrency via revision) |
| `PATCH /api/plans/{id}` | Update plan metadata (e.g. rename) |
| `POST /api/plans/{id}/duplicate` | Duplicate a plan |
| `POST /api/plans/{id}/archive` / `restore` | Soft delete / restore |
| `DELETE /api/plans/{id}` | Permanent delete (requires archived state) |
| `GET /api/plans/{id}/validation` | Circuit loads, over-capacity, floating devices |
| `POST /api/assets` / `GET /api/assets/{id}` | Upload / serve underlay images |

SVG/PNG/JSON export happens client-side; there are no export endpoints.
