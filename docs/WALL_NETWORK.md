# Wall network — design

Status: **phases 0–3c landed, 3d and 4 open** — the `network/` module, the canvas
and export drawing from it, and connectivity now stored on the document (schema
v8). Supersedes the ad-hoc T-junction handling (`Wall.junctions` and
`junctionTrim.ts`). Written against schema v7; lands as schema v8.

## 1. The defect

Walls of different thicknesses that meet do not form one body: surfaces do not
line up, and overlapping bodies show each other's outline strokes as small
seams. Both symptoms have one cause.

**Connectivity is expressible in only two narrow forms today:**

1. _Implicitly, by being in the same chain._ `offsetPolyline` mitres
   consecutive segments of one wall — exact, at any angle, unequal thickness
   irrelevant, because it is all one wall.
2. _Explicitly, by a one-way T record._ `Wall.junctions` is written only by the
   wall tool, only for "I ended in the middle of another wall", and resolved
   only at paint time by `trimEndpointToHostFace`.

Everything else — two separate walls meeting at a corner, three walls at a
point, a partition flush with a shell, a crossing — has **no representation**.
Whether a corner comes out right depends on whether the user happened to draw
both walls in one chain.

Three consequences show this is structural rather than a missing case:

- **The document disagrees with the drawing.** The trim is paint-only, so a
  partition ending on a 12" shell is _stored_ 6" longer than it is drawn.
  Everything parametric hangs off the stored spine — `Opening.t`,
  `DeviceAttachment.t`, `parallelFaceGaps`, hit-testing — so openings and
  devices are addressed along a line longer than the wall on screen.
- **The trim is duplicated outside the geometry module** (`WallsLayer.vue`,
  `svgExport.ts`) even though that module is documented as the single source of
  derived geometry. Duplication outside it means the pipeline lacks a stage.
- **`MAX_TRIM_FACTOR`** — "if the host is farther than two thicknesses, assume
  the record is stale and ignore it" — is a stored-record-vs-derived-geometry
  inconsistency covered by a heuristic. Any patch inherits it.

## 2. Principles

1. **The stored spine is where the wall is.** No consumer needs a correction
   pass to learn the truth.
2. **Constraints edit the document; derivation only computes faces.** A
   relation that must move a wall moves the _stored_ spine, as part of the edit
   command. Nothing is relocated at paint time. The renderer's output therefore
   differs from the document by at most mitre-local amounts.
3. **Topology is stored; geometry is derived.** Joints carry identity and
   intent, never a cached coordinate that can go stale.
4. **One resolved object, all consumers.** Renderer, export, snapping, guides,
   dimensions, devices and hit-testing read the same derived network, so a
   guide cannot pass through a corner that is not drawn.
5. **Coincidence is a checkable invariant** — and derivable from geometry, so a
   plan with no joint records can be healed (this doubles as the v8 migration).

Consequence worth stating plainly: any bug afterwards is either in the
constraint solver (document wrong) or the geometry resolver (drawing wrong),
never in the gap between them, because there is no gap.

## 3. Storage (schema v8)

`Wall` loses `junctions`; `PlanDocument` gains `joints`. A joint is a relation
between wall parties, as a discriminated union — each variant carries exactly
its own fields rather than a god-node with optional arrays.

```ts
/** A wall surface, named in drawing-direction terms (as `WallReference`). */
type WallSide = "left" | "right";

/** One wall end participating in a joint. */
interface WallEndRef {
  wall_id: string;
  end: "start" | "end";
}

/** A wall body a joint passes through (tee, cross). */
interface WallBodyRef {
  wall_id: string;
  segment_index: number;
}

type Joint =
  /** Spines meet at one point; 2..n ends. Faces resolve by angle order. */
  | { id: string; kind: "corner"; ends: WallEndRef[]; rule: "miter" | "square" }
  /** One end abuts another wall's body; the host is unaffected. */
  | { id: string; kind: "tee"; end: WallEndRef; host: WallBodyRef }
  /** Two surfaces are declared to be one surface. Spines are parallel-offset. */
  | {
      id: string;
      kind: "flush";
      a: { ref: WallEndRef; side: WallSide };
      b: { ref: WallEndRef | WallBodyRef; side: WallSide };
    };
```

`corner` and `tee` are topology: they assert coincidence, which the solver
maintains and a validator can check. `flush` is the only kind that can offset a
spine, and it is the kind that makes surfaces line up at unequal thickness.

`Opening` and `DeviceAttachment` keep their `(wall_id, segment_index, t)` form
unchanged — their meaning becomes _correct_ rather than different, because the
spine they measure along is now honest.

## 4. Geometry resolver (pure, derived)

`utils/geometry/network/`:

| Module               | Role                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `wallGraph.ts`       | Builds the incidence graph from `walls` + `joints`; queries (joints at a wall end, walls at a joint) |
| `joinResolver.ts`    | One joint + its parties → the local face geometry. The case table below, and nothing else            |
| `networkGeometry.ts` | `resolveWallNetwork(walls, joints) → ResolvedNetwork`                                                |
| `coincidence.ts`     | Derives joints from geometry (bootstrap / heal / migration)                                          |

`offsetPolyline`'s existing join logic is _absorbed_ by `joinResolver`: a chain's
interior vertex is the same case as "two ends mitre", so there is one
implementation of mitring rather than two.

### Case table

| Relation           | Condition                                       | Resolution                                                                                                                                                    |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| corner, 2 ends     | spines meet, directions not parallel            | pair left-with-left and right-with-right by angle order; each face pair meets at the intersection of its face lines; bevel past the 4× mitre limit (as today) |
| corner, 2 ends     | spines meet, directions anti-parallel           | square caps on both; no mitre point exists                                                                                                                    |
| corner, n ends     | spines meet                                     | sort incident directions by angle; mitre each adjacent pair; every wall's two faces receive exactly one mitre each                                            |
| flush continuation | surfaces declared collinear on side S           | the two flush faces emit as one polyline with no join artifact; the opposite-side step is capped square, perpendicular to the shared direction                |
| tee                | end abuts host body                             | the end is clipped to the host's near face line; the host's own geometry is untouched                                                                         |
| tee + flush        | end abuts host **and** shares a surface with it | tee clip, plus the shared surface continues unbroken                                                                                                          |
| cross              | body crosses body, no end involved              | bodies overlap; resolved by painting connected walls as one fill (§7)                                                                                         |

### Output

```ts
interface ResolvedEnd {
  /** Spine terminus after resolution. */
  spine: Point;
  /** The two face termini — the visible corners of this end. */
  leftFace: Point;
  rightFace: Point;
  joint_id: string | null;
}

interface ResolvedWall {
  wall_id: string;
  /** Faces walked in drawing direction, joins resolved. */
  left: Point[];
  right: Point[];
  /** Closed rings for fill — what the renderer paints. */
  rings: Point[][];
  ends: { start: ResolvedEnd; end: ResolvedEnd };
}

interface ResolvedNetwork {
  walls: ReadonlyMap<string, ResolvedWall>;
  /** The single anchor set for S1e (§6), classified and deduped. */
  anchors: readonly NetworkAnchor[];
  /** Face segments as snap targets — surface snapping (§5). */
  faces: readonly FaceSegment[];
}
```

Computed once per document version and cached (the existing per-wall
`WeakMap` in `WallsLayer.vue` generalizes to one network-level cache keyed on
`documentVersion`).

## 5. Constraint solver (document-level)

`utils/geometry/network/constraintSolver.ts` — pure: document in, document out.
Invoked by edit commands in the editor store, never by render.

- **Input**: the document plus the wall ids the user just changed (seeds).
- **Propagation**: breadth-first from the seeds over the joint graph. Each joint
  satisfies itself by adjusting the _other_ party minimally — perpendicular
  spine offset for `flush`, endpoint move for `corner`/`tee`.
- **Termination**: each joint is satisfied at most once per pass; at most two
  passes, then the edit reports `unsatisfiable` (an over-constrained loop of
  flush relations) and is refused with a status-bar message rather than
  looping. Deterministic, explainable, no numerical solver.
- **Locks**: `locked_segments` (S3b) are barriers — propagation stops and
  reports `blocked`, reusing `chainEdit`'s existing `ok`/`blocked`/`misclosure`
  vocabulary.
- **History**: one propagation is one undo entry; the existing history
  composable snapshots the whole document, so this needs no change.

This solver is also what finally delivers two things the spec promises and the
code does not: S3's "connected walls stay connected" under drag, and thickness
edits propagating to everything joined.

## 6. Authoring changes

**Snapping.** Targets gain `ResolvedNetwork.faces` (surfaces) and face corners.
This subsumes the capture-radius problem — pointing at a thick wall's visible
surface works because the surface _is_ a target, not because the tolerance was
widened to reach an invisible centreline.

On a surface snap the wall tool stores the honest spine and records the joint.
The one genuine wrinkle: at the **first** vertex the wall's direction is not yet
known, so which side is `left` cannot be decided. Resolution: the pending point
rides the surface, and the joint's `side` is fixed on the second click, when the
direction exists. No guessing, no post-hoc correction.

**Editing.** The select tool's vertex and segment drags create and maintain
joints through the same solver. Today they drop attachments entirely
(`useSelectTool.ts` takes `.point` and discards the rest), which is why a
dragged corner silently disconnects.

## 7. Rendering

`WallsLayer.vue` and `svgExport.ts` both read the resolved network, and
`junctionTrim.ts` is deleted.

Fill and stroke separate. Each wall's body is **filled** from its own rings and
never stroked; the outline is a **second path carrying only the edges no joined
wall shares** (`mergedBoundary.ts`). An edge is dropped when it coincides with a
joined wall's edge — that is the line between two merged bodies — or when it lies
strictly inside another wall's body. Both tests are exact line arithmetic.

This replaces the union-by-component sketch this document originally carried.
Unioning per component would have needed either polygon booleans or an
`evenodd` path spanning several walls, where a chain overlapping a closed loop's
band cancels to a hole. Trimming the stroke instead needs neither, and it fixes
a case the union would not have: at a T, the host's own surface line has to
BREAK across the partition's base, which is not something a shared fill does.

Selection highlighting stays per-wall — the full outline, drawn over the merged
body, so the user can still see where one wall ends.

## 8. Guides — what changes and why (S1e)

Anchors today are **spine vertices**, classified by scanning `Wall.junctions`
(`anchorAlignment.ts`). Two problems:

- Guides project through points _inside_ wall bodies. On a 12" shell the anchor
  sits 6" from the visible surface, so new walls are aligned to a phantom
  point. At 3½" the error is 1¾" and looks about right, which is why it went
  unnoticed.
- That function's stated invariant — _"T-junction attachment points always
  coincide with the attached chain's end vertex, so the vertices are the
  complete anchor set"_ — **is only true because the trim is paint-only.** Once
  endpoints are honest it is false. The guides do not merely depend on the
  geometry; they depend on the inconsistency being removed. An additive patch
  that corrected endpoints would silently break them.

Under this design:

- Anchors come from `ResolvedNetwork.anchors`, with kinds
  `face-corner` | `spine-end` | `joint`, ranked in that order — visible corners
  outrank invisible ones, because the user aligns to what is on screen. This
  preserves today's endpoint-outranks-junction ordering and inserts face
  corners above both.
- The anchor count roughly triples, so S1e's noise controls need the extra
  ranking axis; the "at most two guides", "nearest wins", collinear-collapse
  and chain-start-outranks-everything rules are unchanged.
- Joint anchors become exact and complete from the graph. Today only the
  butting wall contributes one and the host side contributes nothing.
- A guide is now _guaranteed_ to pass through a corner that is actually drawn.

`docs/REQUIREMENTS.md` needs amending: S1e for the new anchor kinds and
ranking, and S3a's "its reference line or faces" — currently aspirational —
becomes true.

## 9. Migration (schema v8)

No hand-written data mapping and no data loss: the v8 step drops
`Wall.junctions` and rebuilds `PlanDocument.joints` with `coincidence.ts`,
which derives joints from geometry (coincident ends → `corner`, end on a body →
`tee`, collinear surfaces → `flush`). The same function is reusable at runtime
to heal an imported or hand-edited plan, so it is not migration-only code.

Existing stored plans are development fixtures and may simply be reseeded from
`backend/app/demo/basement_demo.json` instead, if that is preferred.

Backend work is model-only — `backend/models/wall.py`, a new
`backend/models/wall_joint.py`, `plan_document.py`, `schemas.py`, and the v8
step in `plan_migrator.py`. The backend computes no wall geometry, so the
resolver stays frontend-only.

## 10. Phasing

| Phase | Work                                                                                                              | Est.       | State |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ---------- | ----- |
| 0     | This document; characterization tests pinning the current defect                                                  | ½ day      | done  |
| 1     | `network/`: graph, join resolver, resolved network, coincidence bootstrap — pure, fully unit-tested, no consumers | 1.5–2 days | done  |
| 2     | Renderer + export read the network; merged stroke boundaries; delete `junctionTrim`                               | 1 day      | done  |
| 3a    | `PlanDocument.joints` + backend model + v8 migration; the wall tool records tees; heal-on-open                    | ½ day      | done  |
| 3b    | Authoring: surface and corner snap targets, honest endpoints, corner and flush records                            | 1 day      | next  |
| 3c    | Constraint solver wired into the edit commands; select-tool drags maintain relations                              | ½–1 day    |       |
| 4     | Guides/anchors from the network, S1e ranking, requirements amendment                                              | ½–1 day    |       |

Each phase leaves the app working. Phase 2 is the first visible improvement;
phase 3 is where the reported screenshot becomes correct by construction.

### Phase 1 notes

Two things the build taught us, recorded because they change later phases:

- **Coincidence detection must test the body, not the spine.** An honestly
  stored T endpoint sits on the host's SURFACE, half a thickness from its spine,
  so `collectTees` matches against the host's band and accepts a legacy
  spine-placed endpoint as the same T. Landings within tolerance of a segment's
  ends are left for the corner and flush passes, which is what keeps an
  unequal-thickness continuation from being mis-read as a T.
- **Settle once, then verify beats counting passes.** The document proposed a
  two-pass cap for over-constrained loops. Satisfying each relation at most once
  already makes a cycle terminate; re-checking every relation afterwards is what
  reports the ones still violated, and doubles as a standalone document check
  (`violations`). No pass counter, and the report is about the geometry rather
  than about how hard the solver tried.
- **Surface orientation is not cosmetic.** `wallFaceOffsets` names left and
  right relative to a wall's DRAWING direction, so a helper that returned a
  wall's end segment pointing outward silently swapped the two surfaces. Caught
  by the flush solver tests; worth remembering for anything else that takes a
  segment from a wall end.
- **A flush continuation needs no direction guess after all.** The document
  worried that the shared side cannot be known at the first click. True, but the
  spine OFFSET is perpendicular to the shared surface, so it is fixed by the
  host's surface normal alone — and the offset is what places the point. Only the
  side LABEL in the record needs the direction, and that is settled by the
  second click. The placement is derived from the clicked chain rather than
  written back into it, so it re-solves live as the direction, thickness or
  reference side changes.
- **Category priority had to give way to nearest-wins among point targets.** On a
  12" wall the visible corner and the spine end sit 6" apart, so a fixed order
  (end, then surface corner) made whichever lost unreachable — the original
  defect wearing a new hat. Point targets still beat line targets outright per
  S3a; among the points the nearest wins.
- **The spine midpoint is still an invisible point target.** It outranks a
  surface hit within the capture radius, half a thickness inside a thick wall's
  body. Moving the midpoint affordance onto the two surfaces is the same
  argument as the rest of this document and is not yet done.
- **Connectivity can be derived until it is stored.** Phase 2 needed no schema
  change: the canvas and export call `deriveJoints(walls)` and resolve against
  that, so merged bodies work on today's documents. Phase 3 switches the source
  to stored joints and keeps `deriveJoints` as the repair path.
- **The tee clip is strictly better than `trimEndpointToHostFace`.** The old
  trim slides the spine along the wall's own direction, so its cap stays square
  to the butting wall and leaves a wedge at any non-perpendicular approach. The
  network clips both surfaces to the host's face LINE, so an angled T butts
  exactly (`networkGeometry.test.ts`, the 45° case).

## 11. Designed-for edge cases

Enumerated now so they are cases in the resolver rather than later patches:

- Acute-angle mitres past the 4× limit (bevel, as today).
- Anti-parallel ends at one point (doubling back) — no mitre point exists.
- Three or more walls at one joint.
- Closed loops: rings, no free ends, every vertex a join.
- Zero-length and duplicate-vertex segments (`dedupeConsecutive` stays the gate).
- An opening or device straddling a resolved end after a thickness change —
  clamped by `clampOpeningT` against the resolved span, not the raw spine.
- Walls whose reference is already `left`/`right`, where a flush relation is
  the natural default rather than an override.
- Over-constrained flush loops (§5 termination).
- Moving a host wall with several attached ends — one propagation, one undo entry.
- Hit-test tolerance at resolved ends, so clicking a mitre picks the wall the
  user sees.
