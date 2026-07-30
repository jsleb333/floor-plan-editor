# Floor Plan Editor — Requirements

Interactive web editor for residential floor plans and their electrical layout.
The reference use case is digitizing a hand-drawn basement plan: walls, doors,
windows and stairs, plus electrical devices (outlets, switches, lights,
heaters...) connected by colour-coded wires where **each colour is one circuit**
fed from the electrical panel.

Two qualities dominate every decision in this document: **UX** (drawing must
feel fast, forgiving and precise) and **accuracy** (real dimensions, real
electrical loads).

---

## 1. Product vision

A single-user, locally-hosted web app where the user can:

1. Import a photo of a hand-drawn plan, calibrate its scale, and trace over it.
2. Draw a dimensionally accurate floor plan (imperial units, feet and inches).
3. Place electrical devices from a catalog of pictograms on walls or ceilings.
4. Draw smooth, hand-routed wires between devices, grouped into colour-coded
   circuits anchored at a source — the electrical panel, or a feed from another
   floor.
5. Track the electrical load of each circuit against its breaker rating.
6. Export the result as SVG, PNG or JSON.

Out of scope (for now): multi-user collaboration, authentication, mobile/touch
support, full Canadian Electrical Code validation, plumbing/HVAC layers, 3D.

---

## 2. Definitions

| Term          | Meaning                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------- |
| **Plan**      | One floor plan document (e.g. "Basement"). The unit of persistence and export.                |
| **Structure** | Non-electrical geometry: walls, doors, windows, stairs, room labels.                          |
| **Device**    | An electrical element placed on the plan, rendered as a pictogram (outlet, switch, light...). |
| **Circuit**   | A named, colour-coded group of devices protected by one breaker in the panel.                 |
| **Wire**      | A curved line connecting two device terminals, belonging to one circuit.                      |
| **Underlay**  | A raster image (photo/scan) displayed under the plan for tracing.                             |
| **Layer**     | A visibility/locking group: underlay, structure, devices, each circuit's wires, annotations.  |
| **Mode**      | A high-level workspace (Structure, Electrical, Inspector; later Plumbing, Furniture) that scopes which tools the rail offers and what the side panel shows when nothing is armed. Modes never gate data — every layer stays visible and editable per its own rules. |

---

## 3. Units and coordinate system

- Internal canonical unit: **inches**, stored as floats. One drawing unit = 1 inch.
- Display format: feet and inches (`12'6"`, `9'0 1/8"`). Fractional inches
  displayed to the nearest **1/8" by default** (configurable: 1", 1/2", 1/4", 1/8").
- The viewport shows rulers graduated in feet, and a light grid (default 12",
  minor 3") that fades with zoom level.
- All snapping distances and nudge steps are expressed in real units, not pixels.

---

## 4. Geometry & attachment model

The core modelling decisions, stated once so every feature builds on the same
foundation.

### 4.1 Walls are reference polylines, never rectangles

A wall is a **chain**: an ordered list of reference-line vertices, plus
`thickness`, `reference side` (centre/left/right) and per-segment lock flags.
That is the _entire_ stored geometry. The rendered outline — offset faces,
mitred corners, junction cut-outs, square end caps — is **derived geometry**,
recomputed from the reference line on every change and never persisted.

Why not rectangles: a rectangle per wall stores each corner twice (once in
each adjacent wall), so corners drift apart under editing, mitres between
different thicknesses have no single owner, and every move must update
duplicated coordinates. With reference polylines there is one source of truth;
editing is vertex math; corners are always exact by construction.

One shared, deterministic geometry module computes the derived outlines and is
used by _both_ the editor rendering and the SVG export, so what you see is
exactly what exports (and there is exactly one implementation to test).

### 4.2 Wall decorations attach parametrically, not by coordinates

Openings (doors, windows) and wall-mounted devices (outlets, switches,
baseboards...) never store world coordinates. They store a **host address**:

```
attachment: { wall_id, segment_index, t, side }
  t: position along the segment's reference line, in inches from the segment start
  side: left | right  (which face the device sits on; openings span both)
```

World position is always derived from the host wall's current geometry.
Consequences, by design:

- Moving, stretching or exact-dimensioning a wall carries its decorations
  with it — no re-placement, ever.
- Splitting a wall reassigns each attachment to whichever new segment contains
  its position.
- Shrinking a segment below an attachment's position **clamps** the attachment
  to the segment end and flags it in a validation list — nothing is silently
  deleted or left floating.
- Baseboard heaters are attachments with a `length` along the wall; the
  pictogram stretches with it.

Free-standing elements (ceiling lights, smoke detectors, water heater, air
exchanger, central vacuum, labels, the panel if wall-less) store absolute
positions. Wire endpoints reference device ids (never coordinates), so wires
follow their devices; only interior control points are absolute.

---

## 5. Functional requirements

### 5.1 Plan management

- **P1** — The user can create, rename, duplicate and archive plans from a home
  page listing all plans with thumbnail previews.
- **P2** — Deleting a plan is a soft delete (archive); data is never destroyed
  without an explicit, confirmed "permanently delete" action.
- **P3** — The editor autosaves continuously (debounced); the user never has to
  press "save". A saved/saving indicator is visible.
- **P4** — A plan stores everything needed to restore the session: geometry,
  devices, circuits, wires, underlay reference and calibration, layer states,
  last viewport position and the active mode and tool (E10).
- **P5 Creation flow** — "New plan" expands into an inline creation card on
  the home page (no modal): plan name (required, autofocused), optional
  description, and an optional underlay photo drop zone. A collapsed
  "Defaults" expander seeds the plan's settings (§5.9 tier 2: wall thickness
  presets, display precision) from the app preferences. Creating with a
  photo uploads it and opens the editor with the **Calibrate tool** armed
  (Structure mode) and the underlay loaded (U2) — drop, name, calibrate,
  trace. Creating without opens the empty-state editor with the wall tool
  armed (E9). Name and description stay editable later (inline rename in the
  top bar, plan settings in the Inspector mode's overview); the description
  appears on the home-page card under the plan name.

### 5.2 Underlay (trace over a photo)

- **U1** — The user can import a JPEG/PNG image as the plan's underlay.
- **U2** — Calibration: the user draws a reference segment on the image and
  types its real-world length (e.g. `10'`); the underlay is scaled accordingly.
  Calibration can be redone at any time without moving traced geometry.
- **U3** — The underlay can be repositioned, rotated and its opacity adjusted
  (default ~40%); it can be hidden or locked independently of other layers.
- **U4** — The underlay never appears in SVG/PNG exports unless explicitly
  enabled in the export dialog.

### 5.3 Structure drawing

- **S1 Walls** — Drawn as chains of segments with a real thickness. Thickness
  presets: **exterior ~12"**, **interior 3½" (default)** or 4½" (dimensional
  lumber walls); any custom value allowed, editable per wall after the fact.
  Click to place vertices, double-click/Enter/Esc to finish. Angle snapping to
  0°/45°/90° **relative to the global axes** (never to the previous segment, so
  error cannot accumulate around a room); hold a modifier (Alt) to draw free
  angles. Endpoint and midpoint snapping to existing walls, and grid snapping.
- **S1a Wall reference side** — The polyline the user draws is the wall's
  _reference line_; thickness is applied relative to it in one of three modes:
  **centre** (default), **left face**, or **right face** (relative to drawing
  direction). The mode is shown in the tool options and cycled with **Tab**
  while drawing, with a live preview of which side the thickness grows on.
  This is how measurement semantics stay unambiguous: _typed lengths and
  displayed live dimensions always measure along the reference line,
  vertex to vertex_. Tracing a tape-measured room = reference on the inside
  face, draw around the room interior, type the tape readings; thickness grows
  away from the room and interior dimensions are exactly what was typed.
  The reference side of an existing wall can be changed later (geometry is
  re-offset accordingly, reference line stays put).
  The two faces have a consistent **visual identity** everywhere sides
  matter: while drawing and while a wall is selected, the reference line
  renders with its start and end marked (drawing direction is what makes
  left/right meaningful) and each face carries its own subtle tint. The
  same two tints are reused by the S2a dimension-anchor chips, so "which
  face am I measuring to" is legible at a glance. The Inspector offers the
  same centre/left/right control for existing walls plus a one-click
  **swap sides** action (mirror the thickness offset across the reference
  line); both show a live canvas preview before committing.
- **S1b Corners** — Walls meeting join with a mitre, whether they are segments
  of one chain or separate walls: how the plan was drawn never decides how it
  looks. Corners between walls of different thicknesses (e.g. 12" exterior meets
  3½" partition) resolve cleanly — mitred where their spines meet, butted to the
  surface where one ends on the other's body, and sharing a surface where one
  continues the other. Free wall ends are capped square. No gaps, no overlaps,
  at any angle. Connected walls read as **one body**: the outline is drawn only
  where it is not shared with a joined wall, so no seam appears inside a
  merged body. Connectivity is stored on the document and the geometry derived
  from it (`docs/WALL_NETWORK.md`).
- **S1c Closing the loop** — While drawing, when the pending point comes
  within the snap threshold of one of the four 90°/45° **alignment lines
  through the chain's start vertex**, it snaps onto that line and a dotted
  alignment guide is drawn from the start — so the penultimate corner of a
  traced loop lines up exactly with where the loop began instead of being
  eyeballed. When the cursor approaches the start vertex itself, a close
  affordance appears. Clicking it closes the loop: if the chain end is within
  the snap threshold of an alignment line through the start, it is **nudged
  onto that line** (slid along its final segment, preserving that segment's
  angle) and the loop closes with a single exact segment. Otherwise the click
  performs an **auto-square close**: the final corner is solved as the
  intersection of the two constrained direction lines (the segment being
  drawn and the segment arriving at the start vertex), so the loop closes
  _exactly_ while every segment keeps its 90°/45° angle. If the two
  directions don't intersect (parallel), the editor falls back to a direct
  segment to the start point and says so. Holding Alt disables the alignment
  snap and closes with a free-angle segment instead.
- **S1d Smart thickness flow** — There is **one** wall tool; plan content
  drives its defaults. Arming the tool on a plan with **no closed wall
  loop** selects the exterior preset — the first thing drawn on an empty
  plan is the outside shell. Once at least one closed loop exists, arming
  selects the interior default preset. At the moment a loop closes (S1c)
  the active preset switches from exterior to interior default on the spot
  — the next wall is almost always a partition — with the switch announced
  quietly in the status bar. An explicit preset pick by the user always
  wins: it overrides the smart default and suppresses auto-switching until
  the tool is re-armed. Smart selection only ever affects the _next_ wall;
  it never changes anything already drawn.
- **S1e Alignment guides from existing geometry** — The chain-start
  alignment lines of S1c generalize to the whole plan: while a vertex is
  pending, 0°/45°/90° alignment lines are projected through the anchors of
  the **wall network** (`docs/WALL_NETWORK.md`) within a capture radius —
  every **visible surface corner**, every **spine end or bend**, and every
  **T centre**. When the pending point nears one, it snaps onto the line and
  a dotted guide renders back to its anchor, with a small marker identifying
  the anchor; when two guides cross near the cursor, the point snaps to their
  **intersection** — how a new wall lines up with two existing rooms at once.
  Noise control: nearest anchors win, at most two guides render at a time,
  guides fade in/out rather than blink, and the chain-start guides (S1c)
  outrank everything while closing a loop. Where anchors of different kinds
  offer competing lines the **most visible kind wins even when its line is
  farther** — surface corner, then spine end, then T centre — because a guide
  exists to line up with what is drawn, and on a 12" wall the spine sits 6"
  from the edge the user can see. Alt suspends these guides like every other
  snap. The same guides serve the stairs and dimension tools.
- **S1f Wall colours** — A wall draws in one colour, body and outline alike
  (the poché of a paper plan). By default the colour comes from the wall's
  **role**, read off the plan's thickness presets (§5.9 tier 2, whose first
  entry is the exterior preset): a wall at least as thick as that preset is
  the building shell and draws **black**; anything thinner is a partition and
  draws **grey**. Because the default is derived, changing a wall's thickness
  — or the plan's presets — recolours it. Any wall can be given an explicit
  colour instead, from a swatch row (the two role defaults, two intermediate
  greys, and red/blue for the new-work and demolition conventions of a
  renovation plan) or a free colour picker; an explicit pick wins over the
  role default until it is cleared with **Default**. The same control sits in
  the wall tool's options, where it colours the next wall drawn, and in the
  Inspector for an existing wall. Openings read in their host wall's colour,
  and the export prints exactly what the canvas draws.
- **S2 Exact input** — While drawing a wall segment, the user can type a length
  (`12'6`, `9'0 1/8`) to place the next vertex at exactly that distance along
  the current (snapped) direction, measured on the reference line (see S1a).
  Dimensions of the segment being drawn are shown live.
- **S2a Placement by offset (temporary dimensions)** — When a pending point is
  snapped onto an existing wall (S3a projection), **temporary dimensions**
  appear along the host wall: live distance chips from the pending point to
  the nearest perpendicular feature on each side (a crossing wall's face, a
  corner, a junction). These measure **face to face** by default — from the
  neighbouring wall's facing face to the _near face of the wall about to be
  drawn_ (its thickness and reference side are known from the tool presets) —
  because that is what a tape measure gives. Typing a value (e.g. `12'5`) sets
  the highlighted dimension exactly and locks the point; **Tab** switches
  which side's dimension the typed value applies to, and the dimension chip
  can be clicked to cycle its anchor (near face / reference line / far face)
  for the rare non-face measurement. The same mechanism applies when dragging
  an existing wall segment or vertex along a host wall.
- **S3 Editing** — Walls can be selected, moved, split, joined; connected
  walls stay connected. **Vertex drag preserves angles by default**: candidate
  positions are constrained so both adjacent segments stay on allowed
  0°/45°/90° directions (the vertex snaps to intersections of allowed
  direction lines through its neighbours); hold **Alt** to drag freely.
  **Segment drag** translates a wall segment parallel to itself, stretching
  the two adjacent segments while keeping their directions — the primary way
  to resize a room without breaking its right angles.
- **S3a Wall-to-wall snapping** — Starting or ending a wall near an existing
  wall snaps to what is nearest on it: a **surface**, a **visible corner**, a
  wall **end**, or its reference line. Landing on a surface stores the endpoint
  **on that surface** and records a T; landing on a wall end records a corner;
  landing on the terminus of a surface **continues that wall flush**, offsetting
  the new wall so its own surface carries on the captured one, so walls of
  unequal thickness read as one wall. Point targets outrank line targets, and
  among the points the nearest wins — the visible corner and the spine end of a
  thick wall are half a thickness apart, and a fixed order would make whichever
  lost unreachable. Every relation is stored on the document and re-satisfied
  when either wall moves or changes thickness (`docs/WALL_NETWORK.md`). While a segment is being drawn with angle snapping on, the projected
  point is where the segment's _constrained direction_ crosses the host wall
  — the segment keeps its 90°/45° angle and still lands exactly on the wall —
  rather than the freehand perpendicular drop of the cursor (which remains
  the behavior for the first vertex and while Alt is held).
  Endpoint-to-endpoint snapping takes priority over projection when both are
  in range. A click that lands on an existing wall (endpoint, midpoint or
  projection) **terminates the chain** there — reaching existing geometry
  finishes the wall, no Enter needed; starting _on_ a wall does not.
- **S3b Locks and exact-dimension editing** — Each wall segment has a
  **locked/free** flag (padlock toggle in the properties panel and context
  menu; lock-all/unlock-all per chain). Selecting a free segment and typing a
  length sets it exactly: the edit propagates by translating neighbouring
  segments parallel to themselves (angles always preserved, same machinery as
  segment drag) until absorbed by the first _free_ segment parallel to the
  edit direction. **Locked segments never move or change length** — they are
  also immune to drags — so propagation routes around them; when every route
  is blocked, the edit is rejected with the blocking locks highlighted on the
  canvas. No simultaneous constraint solving: edits are sequential and
  deterministic. Intended workflow: trace the loop roughly over the underlay,
  then walk it wall by wall — type the tape measurement, lock, repeat — each
  correction pushed into the remaining free walls.
- **S3c Misclosure feedback** — In a closed loop where all segments but the
  ones being verified are locked, the residual difference between a segment's
  drawn length and the typed measurement is the loop's _misclosure_ (real tape
  measurements rarely close perfectly). The editor reports it explicitly
  (e.g. "loop closes with 1½" left over on this wall") instead of silently
  distorting geometry, so the user can decide where the error belongs.
  Out of scope: constraints between non-adjacent walls, equality/symmetry
  constraints, or any general parametric solver.
- **S4 Doors** — Placed onto a wall (snap to wall); properties: width (default
  30", the common Québec residential interior door), **style**, hinge side,
  swing direction. Six styles cover both room
  and closet doors, each drawn per architectural convention and all
  _derived_ from the host wall's reference line (§4.2):

  | Style           | Symbol                                                                                                                                                      | Reads                                   |
  | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
  | `swing`         | one leaf from the hinge jamb + quarter arc to the far jamb                                                                                                  | hinge, swing                            |
  | `double`        | two half-width leaves hinged at opposite jambs, each arcing to the opening centre, both swinging the same way                                               | swing                                   |
  | `sliding`       | two bypassing panels, one per half of the opening, on opposite faces within the wall thickness                                                              | hinge (which half slides on which face) |
  | `bifold`        | a shallow V of two equal leaves from the stacking jamb to the opening centre                                                                                | hinge (stack side), swing (fold side)   |
  | `double_bifold` | two such Vs, one stacked at each jamb, each spanning half the opening and folding the same way, meeting at the opening centre — the four-panel closet front | swing (fold side)                       |
  | `pocket`        | the leaf on the wall's mid-thickness line, plus a dashed cavity running into the wall past the jamb                                                         | hinge (pocket side)                     |

  A style only ever _reads_ `hinge`/`swing`; the fields are stored for all
  doors, and the UI shows exactly the ones the style reads, labelled for it
  ("Stack side", "Pocket side"). Everything is settable **before**
  placement: the tool's Inspector options (E8) offer the style buttons,
  width presets (24/28/30/32/36/48/60" + custom, which grows the plan's
  list) and the applicable side toggles, all reflected live in the ghost
  preview. The two binary choices are also
  on the cursor: the **swing side follows the side of the wall the cursor is
  on** (hover across the wall to flip it) and **Tab cycles the hinge side**
  while hovering — most doors are placed without touching the panel. For a
  style that ignores a field, the matching gesture simply does nothing.
  Options persist as last-used (§5.9 tier 1); after placement the door stays
  selected for immediate tweaks, style included (E8). A style may also carry
  **its own default width**, applied to the tool the moment the style is
  armed — a `double_bifold` is a 60" closet front, not a 30" doorway. Arming
  such a style deliberately overwrites a width typed just before it (picking
  the style is the later, more specific intent); a width typed afterwards
  wins again, and the applied width is remembered like any other.

- **S5 Windows** — Placed onto a wall; property: width. Rendered with the
  conventional double-line symbol. Width is settable before placement in the
  tool's Inspector options (presets + custom, last-used remembered) and
  reflected in the ghost preview; typed digits set it exactly while
  hovering. After placement the window stays selected (E8).
- **S6 Stairs** — A rectangular stair run with tread lines and a direction
  arrow; properties: width, length, rotation, direction ("up"/"down" label).
  Treads are _derived_ from the length at a conventional pitch — there is no
  per-step model. The tool behaves like every placement tool: width and
  direction are set beforehand in its Inspector options (last-used
  remembered), a **ghost preview appears on hover** (tool width, last-used
  length) before any press, and press-drag sets origin, angle and length —
  angle-snapped to 0°/45°/90° with the run length shown live. **Typing a
  length places the far end exactly** (S2 semantics) and **Tab flips
  up/down** during placement. After placement the stairs stay selected for
  immediate tweaks (E8).
- **S7 Room labels** — Free-placed text labels (name + optional computed-free
  area text). Font size adjustable.
- **S8 Dimension annotations** — The user can add persistent dimension lines
  between two points; they display the real distance and update live when the
  geometry moves.
- **S9 Tape measure and custom guides** — One tool (**M**), SketchUp-style:
  it measures by default, and placing a guide is the byproduct of where the
  clicks land. What the first click captures decides the meaning — plan
  content drives the tool, as in S1d:
  - **Click a wall surface, drag away, click** — places a guide **parallel
    to that surface** at the dragged offset. A live distance chip shows the
    offset while dragging, and typing a value (`36`, `3'0`, S2 conventions)
    places it exactly. The guide is stored **anchored to that wall surface**:
    when the wall moves or changes thickness, the guide keeps its offset —
    it is a relation maintained by the constraint solver
    (`docs/WALL_NETWORK.md`), not a coordinate. This is what a paper
    tape-measure workflow cannot do, and the reason to prefer anchored
    placement wherever a surface was clicked.
  - **Click a wall corner or end, drag, click** — places a guide **through
    that point** at the dragged angle, constrained to 0°/45°/90° unless Alt
    is held (S1 angle conventions); typing a value sets the angle in degrees
    exactly. Anchored to the point: it follows the corner through edits.
  - **Click empty space, drag, click** — places a **free** infinite
    construction line, same angle behaviour, anchored to nothing.
  - **Click two points and press Esc** (or click a second point when the
    first captured nothing to anchor to) — the tool acted as a pure
    **measuring tape**: the distance chip was the deliverable and nothing is
    placed.

  Guides are infinite dashed hairlines, visually distinct from the transient
  S1e alignment guides (different dash rhythm; they do not fade). They are
  first-class elements: selectable, deletable, undoable; the Inspector shows
  the angle and — for anchored guides — the offset, both editable. In the
  snap engine they form a line tier **above wall projections** (the user
  placed them deliberately), and guide×guide and guide×surface crossings are
  point targets; Alt suspends guide snapping like every other snap. A
  Layers-panel toggle hides all guides at once. Guides persist in the plan
  document but are **excluded from export by default** (X4) — they are
  working geometry, like the underlay.

### 5.4 Device catalog

Devices are placed from a searchable palette. Each type has a distinct
pictogram (drawn as SVG, consistent with common electrical-plan symbols and the
hand-drawn legend). Initial catalog:

| Device              | Legend origin                     | Mount   | Voltage | Default load | Default size² |
| ------------------- | --------------------------------- | ------- | ------- | ------------ | ------------- |
| Outlet (duplex)     | Prise électrique                  | wall    | 120 V   | 180 VA¹      | symbol        |
| GFCI outlet         | Prise DDFT                        | wall    | 120 V   | 180 VA¹      | symbol        |
| Switch, single-pole | Interrupteur simple               | wall    | —       | 0            | symbol        |
| Switch, 3-way       | Interrupteur 3-way                | wall    | —       | 0            | symbol        |
| Ceiling light       | Luminaire plafond                 | ceiling | 120 V   | 15 W         | symbol        |
| Wall light          | Luminaire mural                   | wall    | 120 V   | 15 W         | symbol        |
| Baseboard heater    | Plinthe électrique                | wall    | 240 V   | 1000 W       | 36" × 3"      |
| Thermostat          | Thermostat                        | wall    | 240 V   | 0            | symbol        |
| Water heater        | Chauffe-eau (WH)                  | free    | 240 V   | 3800 W       | 22" × 22"     |
| Air exchanger       | Échangeur d'air (EA)              | free    | 120 V   | 150 W        | 30" × 20"     |
| Central vacuum unit | Aspirateur central (VAC)          | free    | 120 V   | 1400 W       | 14" × 14"     |
| Vacuum inlet        | Prise aspirateur                  | wall    | low-V   | 0            | symbol        |
| Smoke detector      | Détecteur de fumée (SD)           | ceiling | 120 V   | 5 W          | symbol        |
| Network jack        | Câble réseau                      | wall    | data    | 0            | symbol        |
| Electrical panel    | Panneau électrique                | wall    | —       | source       | 14" × 4"      |
| Feed from above     | Alimentation de l'étage supérieur | wall    | —       | source³      | symbol        |
| Feed from below     | Alimentation de l'étage inférieur | wall    | —       | source³      | symbol        |

¹ Placeholder per-receptacle allowance; editable per device.

² Footprint of the physically sized types, along the wall × into the room, drawn
at true scale and editable per device (D2). `symbol` means the type has no real
size and always draws as a fixed-size pictogram.

³ The inter-floor feeds are the circuit source of a storey with no panel of its
own: one passes through the ceiling to the floor above, the other through the
floor to the storey below. They carry no load on this plan — their load override
(D2) documents what the feed draws where it actually originates.

- **D1** — Wall-mounted devices snap onto walls and slide along them; they keep
  their wall attachment when the wall moves. Ceiling/free devices place
  anywhere. Placement and sliding reuse the temporary-dimension mechanism
  (S2a): live offsets to the nearest corners/walls, typed value to position
  exactly.
- **D2** — Every placed device has editable properties: label (optional),
  load override (watts), notes. The physically sized types (last column of the
  table) additionally have editable dimensions — length along the wall and depth
  into the room — starting from their catalog footprint and editable both before
  placement and after selection; their outline is drawn at true scale from those
  dimensions. Baseboards also have a wattage.
- **D3** — Devices can be copied/pasted and duplicated by drag+modifier.
- **D4** — Device pictograms keep a constant on-screen legibility: they scale
  with zoom but are clamped to a minimum screen size. A sized device's footprint
  outline is real geometry and is exempt: it always draws at true scale (so a
  22" water heater does shrink when zooming out) while the pictogram inscribed
  in it keeps the clamp.
- **D5** — The catalog is data-driven (a device-type registry), so new types
  can be added without touching editor logic.
- **D6** — Control links: a switch can be linked to the light(s) it controls
  (and 3-way switches paired). Links render as a subtle dashed arc on hover or
  when a linked element is selected. No load impact; documentation value only.

### 5.5 Circuits

- **C1** — A plan has at least one **source**: the electrical panel, or a feed
  from another floor for a storey fed from elsewhere (§5.4). Every circuit
  starts at a source. Circuits are defined in a circuits panel (sidebar)
  listing: colour, name, breaker rating (15 A, 20 A, 30 A...), voltage
  (120 V / 240 V).
- **C2** — Colour is the circuit's identity on the canvas. The app proposes a
  distinguishable default palette; the user can override any colour. Two
  circuits cannot share the exact same colour.
- **C3** — Devices join a circuit by being wired into it (see 5.6). A device
  belongs to at most one circuit (exception: network jacks and vacuum inlets
  join "data"/"low-voltage" pseudo-circuits that carry no load and no breaker).
- **C4 Load tracking** — The circuits panel shows, per circuit:
  `computed load (W and A) / breaker rating`, with amps = watts ÷ voltage.
  A warning state appears above 80 % of the breaker rating (continuous-load
  rule of thumb) and an error state above 100 %. Warnings are informative,
  never blocking.
- **C5** — Devices are colour-coded by circuit: a device wired into a circuit
  draws in that circuit's colour (C2), both its pictogram and its true-size
  footprint outline, on the canvas and in the export alike. A device on several
  circuits (C3) takes the first one in document order; the sources stay ink,
  since they belong to every circuit. Each circuit row carries an explicit
  **isolate** toggle that highlights all its wires and devices on the canvas
  and dims the rest — a dimmed device keeps its circuit colour, just fainter —
  and the selection colour always wins over the circuit colour so a selected
  device stays legible. Isolation is deliberately a *different control* from
  the **active circuit** (W1): clicking a row makes the circuit active (new
  wires land on it); isolating is a separate, explicit action on the row —
  one is a drawing target, the other a viewing filter, and conflating them is
  a known UX trap. Devices not on any circuit can be listed ("unassigned")
  for review.
- **C6** — Per-circuit visibility toggles, on two independent axes: a circuit's
  **wires** and its **devices** can be hidden separately (shift-click either
  toggle to flip both). This reduces clutter, matching how one reads the paper
  plan one colour at a time. A device only disappears once every circuit it
  belongs to has its devices hidden; devices on no circuit, and the sources,
  always stay visible. Circuits default to fully visible.

### 5.6 Wires

- **W1** — A wire connects two devices (or a device and the panel). Drawing:
  click a source device, click a target device; the wire is created on the
  currently active circuit and inherits its colour. The active circuit's home
  is the Wire tool's own options — the circuits list (§6.1) — never a
  separate panel; while the Wire tool is armed, digits <kbd>1</kbd>–<kbd>9</kbd>
  switch the active circuit and the status bar echoes its name and colour.
  Clicking the canvas with no circuit yet raises a quiet status notice (§6.2),
  never a dialog.
- **W2** — Wires render as smooth curves (cubic Bézier splines). A new wire
  gets a gentle auto-curve; the user can then drag the curve or its control
  handles to route it exactly where they want (matching the hand-drawn look,
  e.g. hugging walls or fanning out from the panel).
- **W3** — Wire endpoints stay attached to their devices when devices move;
  interior control points move proportionally.
- **W4** — Connectivity defines membership: a device is "on" circuit X when a
  wire path connects it (through other devices) to a source on circuit X.
  Devices wired together but not reaching a source are flagged "floating" in
  the circuits panel. Sources are the roots: they are neither connected nor
  floating, and their own load never joins a circuit sum.
- **W5** — Deleting a device offers to reconnect or delete its wires.

### 5.7 Selection and editing UX

- **E1** — Tools: Select (default), Wall, Door, Window, Stairs, Label,
  Dimension, Device (with type picker), Wire, Measure (ephemeral tape),
  Calibrate. Tools are grouped into **modes** (E10); each tool has a
  single-letter shortcut scoped to its mode, shown in tooltips.
- **E2** — Select tool: click to select, shift-click to add, drag for rubber
  band selection, drag selection to move. Selected elements show handles and a
  contextual properties panel.
- **E3** — Full undo/redo (Ctrl+Z / Ctrl+Shift+Z) across every mutating
  action, including property edits, with a practical history depth (≥100).
- **E4** — Esc cancels the in-progress action; Delete removes the selection;
  arrow keys nudge by 1" (Shift = 12").
- **E5 Viewport** — 60 fps interaction target on plans of realistic size
  (≤ 200 devices, ≤ 300 wires, ≤ 500 wall segments). The complete gesture
  set, which the in-app shortcut overlay (<kbd>?</kbd>) mirrors:

  | Gesture                                | Result                                                                                                                |
  | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
  | <kbd>Space</kbd> + left-drag           | Pan. Armed only while the pointer is over the canvas, so <kbd>Space</kbd> still activates a focused button elsewhere. |
  | Middle-drag                            | Pan.                                                                                                                  |
  | Two-finger trackpad scroll             | Pan, both axes.                                                                                                       |
  | <kbd>Shift</kbd> + wheel               | Pan horizontally.                                                                                                     |
  | Wheel                                  | Zoom to cursor.                                                                                                       |
  | <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + wheel | Zoom to cursor, whatever the scroll mode.                                                                             |
  | Trackpad pinch                         | Zoom to cursor (arrives as <kbd>Ctrl</kbd> + wheel).                                                                  |
  | Top bar / status bar                   | Zoom to fit, 100 % zoom, scroll mode.                                                                                 |

  Whether an unmodified scroll zooms or pans follows the **scroll mode**, a
  persisted preference toggled in the status bar: `auto` (default) sends
  discrete mouse-wheel notches to zoom and continuous trackpad scrolling to
  pan; `zoom` and `pan` pin one behaviour for hardware the heuristic reads
  wrong. Wheel deltas are normalised across `deltaMode`, so a Firefox
  line-mode notch zooms as much as a Chromium pixel-mode one.

  Zoom-to-fit frames the plan's real content bounds — the same geometry the
  SVG export measures — falling back to a 30' region on an empty plan.

- **E6** — Snapping is always visualized (snap markers, alignment guides)
  before the click commits, so the user can trust what will happen.
- **E7** — Layer visibility and locking. Whole-plan rows (underlay,
  structure, devices, annotations) live in the Inspector mode's overview
  (§6.1); per-circuit rows live on the circuit rows themselves (C6). Locked
  layers are not selectable. There is no standalone layers panel.
- **E8 Tool ergonomics — preview, options, place-then-tweak** — Every
  placement tool honours the same contract:
  - **Ghost preview**: a faithful preview of exactly what a click would
    create renders at the cursor before commit (E6 applied to placement).
  - **Options in the Inspector**: while a tool is armed, the Inspector shows
    its options — the same properties the element will be created with
    (door width/style/hinge/swing, window width, stairs width/direction, wall
    thickness/reference, device type...). They apply to the ghost live and
    persist as last-used (§5.9 tier 1).
  - **Place-then-tweak**: a just-placed element becomes the current
    selection and its full properties are editable in the Inspector
    immediately — no switching to Select to fix the thing just placed. The
    next placement click simply continues the tool.
  - **Edit in-tool**: with a tool armed, clicking an existing element _of
    the tool's own kind_ selects it for editing instead of placing a new
    one — the click target disambiguates (door tool: a click on a wall
    places a door, a click on an existing door edits it). Esc clears the
    selection back to pure placement. The wall tool is the one exception:
    clicks on walls are drawing semantics (S3a); walls are edited with
    Select.
- **E9 Content-aware startup** — Opening a plan with no walls lands in
  **Structure mode** with the **wall tool** armed (exterior preset, S1d) —
  or the calibrate tool when an underlay awaits tracing (P5/U2): the empty
  state's one job is getting the first wall drawn. Otherwise the editor
  restores the last active mode and tool from the saved session (P4),
  defaulting to Structure / Select; a saved tool missing from the saved mode
  resolves the mode from the tool. The empty state also offers the two entry
  paths — "import a photo to trace" / "start drawing walls" (§6.2).
- **E10 Modes** — The workspace is split into modes, each a phase of the
  real workflow. A mode scopes the **tool rail** and the side panel's
  **overview** (§6.1); it never gates data — every layer keeps its own
  visibility and editability rules regardless of mode. Membership is
  data-driven and many-to-many: a tool declares the modes it belongs to, and
  the same tool may appear in several (pick-and-choose, not pinning).

  | Mode | Key | Tools (letter) |
  |---|---|---|
  | Structure | <kbd>S</kbd> | Select V · Wall W · Door D · Window N · Stairs S · Calibrate C · Label T · Dimension X |
  | Electrical | <kbd>E</kbd> | Select V · Device D · Wire W · Label T |
  | Inspector | <kbd>I</kbd> | Select V · Measure M · Dimension X · Label T |

  - **Chorded, mode-scoped shortcuts** — letters resolve against the active
    mode's tools first, then against mode letters: <kbd>E</kbd> <kbd>W</kbd>
    arms the Wire tool from anywhere, VSCode-style. Scoping is what lets
    <kbd>D</kbd> mean Door in Structure and Device in Electrical without a
    global registry of conflicts. Precedence, top first: the armed tool's own
    key handling (typed input, Esc ladders, the Wire tool's circuit digits) →
    the active mode's tool letters → mode letters. Two invariants, enforced
    by tests: tool letters are unique *within* each mode, and a mode's letter
    never collides with a tool letter of any *other* mode (or that mode
    becomes unreachable from there).
  - **Switching modes** arms Select and clears the selection, landing on the
    mode's overview panel (§6.1). Arming a tool via chord switches to its
    mode implicitly.
  - **Persistence** — the active mode is stored in the document next to the
    active tool (P4, §8).
  - **Context dimming** *(should)* — in Electrical mode, structure renders
    dimmed (still snappable and selectable) so devices and wires read first;
    Structure and Inspector modes render everything at full strength.
  - Future modes (Plumbing, Furniture/Decoration) ship only once they
    contain tools — an empty mode reads as broken.

### 5.8 Export

- **X1 JSON** — Lossless export/import of the full plan document (the same
  schema used for persistence). Re-importing a JSON produces an identical plan.
- **X2 SVG** — Vector export, real-unit coordinates, with layers as named
  `<g>` groups (structure, devices, one group per circuit, annotations), so it
  is editable in Inkscape/Illustrator.
- **X3 PNG** — Raster export with selectable resolution/scale and optional
  transparent background.
- **X4** — Export dialog offers: layers to include, with/without underlay,
  with/without dimension annotations, with/without custom guides (S9; off by
  default), with/without the legend and its language.
- **X5 Legend** — SVG and PNG exports carry a **legend** panel (its own
  `#legend` group, in a column right of the plan, growing the sheet rather
  than covering it). It is derived from the sheet itself, so it can never
  advertise a symbol the plan does not carry: the circuits included in this
  export with their colour and rating (breaker/voltage, or the kind for a
  data/low-voltage pseudo-circuit), the device types actually placed with
  their pictogram and count, and the wall colours actually drawn with their
  role. Available in **English** and **Québec French** — the editor's own
  words are translated (device names come from the catalog's French legend
  column, §5.4), user text (circuit names, room labels) never is. The dialog
  preselects French for a French browser.

### 5.9 Settings and user-settable properties

Guiding rule: **anything that varies in the physical world is settable per
instance**; catalogs and presets provide defaults, never hard limits. Three
tiers, from global to local:

**Tier 1 — App preferences** (stored in the browser, apply to all plans):
display resolution (1/8" default), grid size, default snap toggles, panel
collapsed states, last-used tool options.

**Tier 2 — Plan settings** (stored in the plan document, so plans are
self-contained): plan description, wall thickness presets (default list:
12" exterior, 4½" interior, 3½" interior _default_; user-editable), display
precision override (falls back to the tier-1 app preference when unset),
device catalog defaults (per-type default load — e.g. change "baseboard
default" from 1000 W to 750 W; affects future placements, with an explicit
"apply to existing" action, never a silent retroactive change). All of
these are seeded by the creation card (P5) and editable afterwards in the
mode overviews (§6.1): wall thickness presets in the Structure overview,
the rest in the Inspector overview. Door/window/stairs width option buttons are
also per-plan presets, but grown rather than seeded: each tool starts from a
built-in default list, and a custom value typed and committed in that
tool's options is added as a one-click preset for the rest of the plan.

**Tier 3 — Per-element properties** (the Inspector panel):

| Element | Settable properties |
|---|---|
| Wall | thickness (preset or custom), reference side, colour (role default or explicit), per-segment locks |
| Door | width, hinge side, swing direction |
| Window | width |
| Stairs | width, length, rotation, direction (up/down) |
| Device (all) | label, notes, load override (W) |
| Baseboard heater | + length along wall, wattage (presets 500/750/1000/1250/1500/2000 W or custom; amps derived at 240 V) |
| Circuit          | name, colour, breaker rating, voltage, kind (power/data/low-V)                                        |
| Wire             | curve shape (control handles)                                                                         |
| Underlay         | opacity, visible, locked, recalibrate                                                                 |
| Label            | text, size                                                                                            |
| Dimension        | anchor points, side offset                                                                            |

---

## 6. UI layout & UX principles

### 6.1 Layout — mode pill, tool rail, contextual panel

Fixed, predictable homes for everything. The canvas is **full-bleed**: it
extends beneath the chrome, which is drawn as **fixed-position floating
panels** — rounded, shadowed, margined off the edges — that size themselves
to their content. Zoom-to-fit compensates for the overlap with per-side
occlusion insets matching the chrome, so a fitted plan lands in the visible
region, not under a panel. Nothing is draggable; nothing overlaps anything
else's home. Surfaces are solid for now (a translucent "glass" treatment is
a later tuning pass, gated on the E5 frame budget and a
`prefers-reduced-transparency` fallback).

```
┌──────────────────────────────────────────────────────────────┐
│ ◂ plans │ Basement ✎           saved ✓     100% ▾  ⤢  ↶ ↷  ⇓ │  top bar
├─────┬─────────────────────────────────────────┬──────────────┤
│ ╭─╮ │      ╭─ Structure · Electrical · … ─╮   │ ╭──────────╮ │
│ │V│ │      ╰────────── mode pill ─────────╯   │ │ overview │ │
│ │W│ │                                         │ │    OR    │ │
│ │D│ │            C A N V A S                  │ │ tool opts│ │
│ │…│ │     rulers ∙ grid ∙ snap guides         │ │ + sel.   │ │
│ ╰─╯ │                                         │ ╰──────────╯ │
├─────┴─────────────────────────────────────────┴──────────────┤
│ snap: ⊞ ∠ ⊢ │ ref: inside │ ⚠ 2 │ 12'5 ⏎ │ x, y             │  status bar
└──────────────────────────────────────────────────────────────┘
```

- **Top bar**: back to plan list, inline-renamable plan name, autosave
  indicator, zoom controls / zoom-to-fit, undo/redo, export.
- **Mode pill** — floating top-centre over the canvas: one segment per mode
  (E10), the active one highlighted, mode letters in tooltips.
- **Left tool rail**: icon-only tools **of the active mode**, each with its
  mode-scoped letter in the tooltip. The Device tool opens a searchable
  pictogram picker with most-recently-used types on top.
- **Right panel** — ONE contextual panel, no tabs, no navigation. It always
  shows, top to bottom:
  1. **Tool options** while a tool with options is armed — the same
     properties the element will be created with (E8), plus the placement
     hint. The Wire tool's options are the **circuits list itself**: create,
     rename, colour, breaker/voltage/kind, the active row (W1), the isolate
     toggle (C5), per-circuit wires/devices visibility (C6), live
     `load / breaker` bars and floating/unassigned findings (C4/W4). The
     Calibrate tool's options are the underlay controls (import, opacity,
     rotation, scale, recalibrate, remove).
  2. **Selection** below — the selected element's inspector (any kind under
     Select; the tool's own kind while a placement tool is armed, E8).
  3. **Mode overview** when nothing is armed beyond Select and nothing is
     selected — the mode's home screen:
     - **Structure** — underlay controls (same block the Calibrate tool
       shows) and wall thickness presets.
     - **Electrical** — the circuits list, verbatim the Wire tool's options:
       one component, two entry points, zero duplication.
     - **Inspector** — plan settings (name, description, display
       precision), whole-plan layer visibility (underlay, structure,
       devices, annotations — E7), and export.
- **Bottom status bar**: live snap toggles, wall reference side (during wall
  drawing), the circuit-warning indicator (⚠ + count when any circuit is
  over 80 %, C4 — clicking it switches to Electrical mode), the active
  circuit's swatch and name while wiring (W1), the typed-input echo (what
  you type — `12'5` — appears here before Enter commits it), cursor
  coordinates in feet/inches.

### 6.2 UX principles

- **Canvas-first** — panels are slim and collapsible; the drawing dominates.
  No ribbons, no menu bars, no nested menus.
- **Contextual, not modal** — properties always live in the Inspector, never
  in pop-up dialogs. The only modal dialogs in the app: export options and
  permanent-delete confirmation.
- **Keyboard-first, mouse-complete** — every mode and tool has a letter;
  tool letters are scoped to the active mode and chain through mode letters
  (<kbd>E</kbd> <kbd>W</kbd> = Electrical → Wire, E10), discoverable via
  tooltips and a `?` shortcut overlay organised by mode; but every action is
  also reachable by mouse alone.
- **Typed precision everywhere** — any time a length is being determined
  (drawing, temporary dimensions, dragging), typing digits switches to exact
  input, echoed in the status bar. The keyboard is the tape measure.
- **Always show what will happen** — snap targets, angle locks, close
  affordances, reference-side previews and drag outcomes are visualized
  _before_ the click commits (E6). No surprises.
- **Progressive disclosure** — common properties visible; rare ones (notes,
  load overrides) behind a "More" expander in the Inspector. New-plan empty
  state offers the two entry paths: "import a photo to trace" or "start
  drawing walls".
- **Quiet feedback** — autosave state, misclosure reports and load warnings
  appear as unobtrusive indicators and badges, never interrupting dialogs.

---

## 7. User stories (acceptance level)

1. _As the homeowner_, I import the photo of my basement drawing, calibrate it
   with a known 10' wall, and trace all walls in under 30 minutes.
1. _As the homeowner_, I walk the traced loop wall by wall with my tape
   measurements: type the exact length, lock the wall, move on — each
   correction is absorbed by the still-free walls, and at the end the editor
   tells me my measurements close within 1".
1. _As the homeowner_, I place all outlets, switches and lights by picking
   pictograms and clicking on walls; outlets snap flush to walls automatically.
1. _As the homeowner_, I create a circuit "Prises sous-sol", 15 A / 120 V,
   pick red, and wire the panel to each outlet with curves I can reshape.
1. _As the homeowner_, I see that my heating circuit's baseboards total
   4750 W on a 20 A / 240 V breaker (24.7 A) and get an over-capacity error,
   so I split it into two circuits.
1. _As the homeowner_, I toggle every circuit off except one to verify it
   against the paper plan colour by colour.
1. _As the homeowner_, I export an SVG to print and annotate, and a JSON as a
   backup.
1. _As the homeowner_, I come back a week later; my plan reopens exactly as I
   left it, including zoom position and layer visibility.
1. _As the homeowner_, I drop my basement photo on the New plan card, type a
   name, and land directly in calibration — I'm tracing within a minute.
1. _As the homeowner_, I open a fresh plan and the wall tool is already
   armed with the exterior preset; the moment I close the outside loop the
   preset flips to interior and I draw partitions without touching a panel.
1. _As the homeowner_, I pick a 30" door, flip its hinge with Tab and its
   swing by hovering across the wall, place it, then adjust its width in
   the Inspector — all without ever leaving the door tool.

---

## 8. Data model (persistence schema, v1)

A plan is stored as one versioned JSON document plus uploaded underlay images.

```
Plan
  id: uuid            name: str           schema_version: int
  description: str    # optional, shown on the home-page card (§5.1 P5)
  created_at, updated_at, archived_at: datetime | null
  viewport: { center: Point, zoom: float }
  underlay: Underlay | null
  walls: [Wall]           # each: id, vertices [Point] (reference line),
                          # thickness_in, reference: center|left|right,
                          # color: str | null,  # #rrggbb override; null = role default (S1f)
                          # locked_segments: [int]  # indices of locked segments (S3b)
  joints: [Joint]         # wall connectivity, document-level and symmetric (v10):
                          # corner {ends: [wall end refs]} | tee {end, host segment}
                          # | flush {two surface parties} — docs/WALL_NETWORK.md
  guides: [Guide]         # S9 custom guides (v10): id, anchor
                          # (wall surface + offset_in | wall end point | free origin),
                          # angle_deg for unanchored/point-anchored lines
  openings: [Opening]     # door|window: id, attachment (§4.2), width_in,
                          # style (swing|double|sliding|bifold|double_bifold|pocket, S4), hinge, swing
  stairs: [Stairs]        # id, rect, direction
  labels: [Label]         # id, position, text, size
  dimensions: [Dimension] # id, p1, p2, offset
  devices: [Device]       # id, type, label, load_w override, notes,
                          # attachment (§4.2) | position+rotation (free-standing),
                          # footprint overrides (length_in, depth_in) for sized types
  catalog_defaults: {type: load_w}   # plan-level device defaults (§5.9 tier 2)
  thickness_presets: [float]         # plan-level wall presets (§5.9 tier 2)
  display_precision: float | null    # per-plan override, inches (§5.9 tier 2)
  circuits: [Circuit]     # id, name, color, breaker_a, voltage_v, kind (power|data|lowv)
  wires: [Wire]           # id, circuit_id, from_device_id, to_device_id,
                          # control_points: [Point]
  control_links: [Link]   # switch_id -> device_id, kind (controls|3way-pair)
  active_tool: str | null # last armed tool, restored on open (P4, E9)
  active_mode: str | null # last active mode, restored on open (P4, E10)

Underlay
  image_ref: str          # server-stored asset id
  transform: { origin: Point, rotation: float, scale: float }  # from calibration
  opacity: float          locked: bool      visible: bool
```

- Points are `{x, y}` in inches. Load values in watts.
- `schema_version` + explicit migration step on read: old documents are
  migrated forward, never rejected, never destroyed (a pre-migration copy is
  kept).
- Storage: SQLite (`aiosqlite`) — `plans` table with the JSON document in a
  column, plus metadata columns for listing; `assets` table for underlay
  images. Load computation exists **twice** on purpose: the backend service
  serves the API (fixtures, integration tests, automation), and the frontend
  mirrors the same computation so live editing never waits on a round trip —
  the editor reads only its own copy. Neither is "the" source of truth; the
  shared fixture corpus in `tests/fixtures/circuit_validation/` is, and both
  test suites parametrize over it so a rule added to one side fails the other.

---

## 9. API surface (v1)

| Method & path                               | Purpose                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /api/plans`                            | List plans (metadata + thumbnail).                                                                |
| `POST /api/plans`                           | Create plan (name, optional description, optional underlay asset id + seeded defaults — §5.1 P5). |
| `GET /api/plans/{id}`                       | Full plan document.                                                                               |
| `PUT /api/plans/{id}`                       | Replace plan document (autosave). Optimistic concurrency via document revision.                   |
| `POST /api/plans/{id}/duplicate`            | Duplicate.                                                                                        |
| `POST /api/plans/{id}/archive` / `restore`  | Soft delete / restore.                                                                            |
| `DELETE /api/plans/{id}`                    | Permanent delete (requires archived state).                                                       |
| `GET /api/plans/{id}/validation`            | Circuit loads, over-capacity, floating devices.                                                   |
| `POST /api/assets` / `GET /api/assets/{id}` | Upload / serve underlay images.                                                                   |

Export to SVG/PNG/JSON happens client-side (the canvas is already SVG);
no export endpoints in v1.

---

## 10. Architecture notes

Follows the hexagonal layout and conventions in `.claude/CLAUDE.md`:

- **Backend** is a thin persistence + validation service: `PlanService`
  (CRUD, migration), `CircuitValidationService` (loads, floating devices),
  `AssetService` (underlay images) behind repository interfaces
  (`PlanRepository`, `AssetRepository`) implemented on SQLite; wired with
  dishka. FastAPI serves the built SPA in production.
- **Frontend** owns all editing interaction. Rendering is a single SVG
  viewport (which makes X2 nearly free). Editor state lives in Pinia stores
  (`plans`, `editor`); behaviours in composables (`useViewport`,
  `useSnapping`, `useHistory`, `useWireEditing`, `useExport`...). The
  undo/redo history is command-based and lives entirely client-side.
- Autosave: debounced (~2 s after last change) `PUT` of the full document
  with a revision counter; on 409 the client reloads and informs the user.

### 10.1 Technology decisions

Guiding philosophy: **the editor is the product** — own the canvas, the
geometry and the document model; take dependencies only for commodity.

| Concern          | Decision                                                        | Rationale / rejected alternatives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas rendering | **Plain SVG, Vue-rendered components**                          | ≤ ~3k nodes at realistic plan size → 60 fps is achievable with pan/zoom as a single root `<g transform>`. Crisp vectors at any zoom, DOM hit-testing and CSS hover for free, and SVG export = serialize the rendered tree (one geometry path, zero drift). _Rejected:_ Konva/Fabric/PixiJS — canvas/WebGL pays off at 10k+ elements and would force custom hit-testing plus a second SVG-generation path.                                                                                                               |
| Pictograms       | SVG `<symbol>`/`<use>` registry                                 | Data-driven catalog (D5); one definition per device type, instanced cheaply; min-size clamp (D4) via counter-scaling.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Geometry math    | **In-house typed module** (`utils/geometry/`)                   | Needs: polyline offset, line intersection (mitres, auto-square close), point projection (snapping), cubic Béziers. A few hundred lines of pure functions, shared by render + export (§4.1), heavily Vitest-tested. _Rejected:_ Turf/Clipper — GIS/boolean-ops power we don't need (openings are path gaps, not booleans).                                                                                                                                                                                               |
| Undo/redo        | Command stack with inverse operations                           | Single user → no Immer/Yjs/CRDT. Commands double as the mutation API of the editor store.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| UI chrome        | Tailwind + bespoke components, **no component kit**             | Tool rail / inspector / status bar are exactly what kits do badly. Icons from Lucide (tree-shakeable) as the only UI dependency.                                                                                                                                                                                                                                                                                                                                                                                        |
| Units I/O        | In-house feet-inches parser/formatter (`12'5 1/8"`)             | Trivial, and precision rules (§3) are ours.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| PNG export       | Serialize SVG → offscreen canvas → blob                         | No dependency needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Backend stack    | FastAPI + Pydantic v2, aiosqlite, dishka, loguru (per scaffold) | Thin persistence/validation layer; underlay images on disk under a data dir (path via pydantic-settings), metadata in SQLite. Beyond persistence, the REST API is the app's **automation surface**: fixtures, integration tests, state inspection, and agent-driven workflows (e.g. generating a plan document programmatically) all go through it — impossible with browser-local storage.                                                                                                                             |
| Document storage | SQLite as a document store (JSON column + metadata columns)     | "NoSQL" is a schema decision, not an engine: we need atomic writes (autosave must never tear a document), a revision counter, list-page metadata without parsing documents, one-file backup — SQLite gives all four. _Rejected:_ JSON files on disk (reimplements transactions/indexing badly; git-diffability is covered by JSON export), document-DB servers (ops burden absurd for single-user). Escape hatch: SQLite generated columns over `json_extract` can index any document field later, no engine migration. |

---

## 11. Milestones

1. **M1 Skeleton** — backend CRUD + SQLite, SPA shell, plans home page,
   editor page with pan/zoom viewport, autosave loop.
2. **M2 Structure** — walls with snapping and exact input, doors, windows,
   stairs, labels, dimensions, undo/redo.
3. **M3 Underlay** — image upload, calibration, opacity/lock.
4. **M4 Devices** — catalog, wall snapping, properties panel, copy/paste.
5. **M5 Circuits & wires** — circuits panel, Bézier wires, connectivity,
   load tracking, highlight/isolate, control links.
6. **M6 Export & polish** — SVG/PNG/JSON export, layers panel, thumbnails,
   keyboard shortcut reference, performance pass.
7. **M7 Demo plan** — digitize the hand-drawn basement plan
   (bundled as `backend/app/demo/basement_photo.jpg`) as a "demo" plan, as close
   as possible to the original drawing: photo as calibrated underlay, all
   walls/openings/stairs traced, every legend device placed, all circuits
   wired with their original colours. Installed on first run as both a
   showcase and the definitive end-to-end acceptance test of M1–M6 (positions
   proportional from the photo; exact dimensions refinable later via the S3b
   lock workflow).
8. **M8 Drawing-flow polish** — creation card with photo drop (P5);
   content-aware startup and smart wall presets (E9, S1d); pre-placement
   options, hover ghosts, place-then-tweak and edit-in-tool for
   door/window/stairs (S4–S6, E8); plan-wide alignment guides (S1e); wall
   face identity and side swapping (S1a); plan description and per-plan
   display precision (§5.9 tier 2).
9. **M9 Modes & contextual panel** — the mode model with chorded,
   mode-scoped shortcuts and per-plan persistence (E10); the floating mode
   pill and mode-filtered tool rail (§6.1); the tabbed side panel replaced by
   one contextual panel with mode overviews (§6.1); the circuits list becomes
   the Wire tool's options and the Electrical overview (W1); the
   active-vs-isolated circuit split (C5); the layers panel dissolved
   (underlay → Calibrate/Structure, whole-plan rows → Inspector overview,
   E7); the circuit ⚠ indicator moves to the status bar; floating-chrome
   restyle (solid surfaces).

Each milestone ends with `poe check` green and the relevant user stories
demonstrable in the running app.
