import { computed, ref, shallowRef } from 'vue'
import type { ComputedRef, Ref, ShallowRef } from 'vue'

import type { Guide, Point, Wall, WallEndRef, WallSide } from '@/types/plan'
import {
  add,
  angleOf,
  distance,
  dot,
  normalize,
  perpendicular,
  resolveGuideLine,
  scale,
  sub,
} from '@/utils/geometry'
import { formatFeetInches, parseFeetInches } from '@/utils/units'

import type { SnapMarkerKind, SnapResult, SnapTarget, UseSnappingReturn } from './useSnapping'
import { isBufferKey } from './useWallTool'

const RAD_TO_DEG = 180 / Math.PI
/** An angle is a plain number of degrees, so its buffer takes digits and a decimal point only. */
const ANGLE_CHAR_PATTERN = /^[0-9.]$/
/** Angles read at one decimal; `22.50°` and `0.0°` are noise. */
const ANGLE_DECIMALS = 1
/** Id of the guide resolved while placing; it is never committed. */
const PENDING_GUIDE_ID = 'tape-pending'
/** Fallback direction for a drag with no extent yet, so the preview and the commit agree. */
const DEFAULT_DIRECTION: Point = { x: 1, y: 0 }

/**
 * The form the pending guide currently takes (spec S9): an offset parallel to
 * what was clicked, an angle through an anchored point, or a free angle through
 * a point anchored to nothing. The first click picks it and Tab swaps it where
 * the capture offers both.
 */
export type TapeMode = 'idle' | 'offset' | 'angle' | 'free'

/** The two forms a placement can take once the first click has landed. */
type PendingForm = Exclude<TapeMode, 'idle'>

/** The live readout beside the cursor: one headline value, one optional secondary. */
export interface TapeChip {
  at: Point
  /** The value the tool is placing: the offset, or the angle — in free mode the distance. */
  text: string
  /** Second reading when the headline is not the whole story (free mode's angle). */
  secondary: string | null
}

/** Everything the overlay needs to visualize the tape measure and its pending guide (spec E6). */
export interface TapeToolPreview {
  mode: TapeMode
  /** The first click's snapped point, once placed. */
  start: Point | null
  /** Snapped cursor — the point the next click would use. */
  point: Point | null
  /** The pending guide's world line: the INFINITE line through `point` along `dir`. */
  line: { point: Point; dir: Point } | null
  chip: TapeChip | null
  /**
   * Distance from the first point to the cursor — the tape reading, which in
   * free mode is the whole deliverable even when nothing is placed (spec S9).
   */
  measurement: string | null
  marker: { kind: SnapMarkerKind; point: Point } | null
}

export interface UseTapeToolOptions {
  /** Shared snap engine; the first click's target is what classifies the placement. */
  snapping: UseSnappingReturn
  /**
   * The document's walls, to turn a clicked surface into its world line. Read
   * through `resolveGuideLine`, the same path the committed guide resolves
   * through, so the guide lands on the line the user was shown.
   */
  walls: Ref<readonly Wall[]>
  /**
   * The document's guides, so a click that captured one can be resolved back to
   * the guide it came from: clicking a guide measures FROM it (spec S9), and
   * what the placement inherits depends on what its source is anchored to.
   */
  guides: Ref<readonly Guide[]>
  /** Receives each placed guide; the caller dispatches the store command. */
  commit: (guide: Guide) => void
  /** Display precision for the distance readouts (spec §5.9 tier 2); 1/8" when omitted. */
  displayPrecisionIn?: Ref<number> | ComputedRef<number>
}

export interface UseTapeToolReturn {
  preview: ComputedRef<TapeToolPreview | null>
  /** Typed exact value: feet-inches for an offset, degrees for an angle (spec S2). */
  inputBuffer: Ref<string>
  /** True once the first click landed and a placement is pending. */
  isMeasuring: ComputedRef<boolean>
  setCursor: (point: Point | null) => void
  setAlt: (held: boolean) => void
  onClick: (world: Point) => void
  /**
   * Routes a key press to the tool; returns true when consumed (the caller must
   * then preventDefault/stopPropagation). Handles Enter, Escape, Backspace, Alt,
   * Tab — which swaps the pending guide's form when the capture offers both —
   * and the exact-input buffer characters of the active mode.
   */
  handleKey: (key: string) => boolean
  /** Abandons the pending placement — the measurement was the deliverable (spec S9). */
  cancel: () => void
  /** Cancels the pending placement and clears modifier state (on tool switch). */
  deactivate: () => void
}

/** The stored relation an offset placement commits to. */
interface SurfaceRelation {
  wall_id: string
  segment_index: number
  side: WallSide
}

/**
 * The line a parallel placement measures from — a clicked wall surface, or a
 * clicked guide's own line — plus what a commit on it records.
 */
interface ParallelBase {
  /** A point on the base line itself: where the drag reads zero. */
  point: Point
  /** Unit direction of the base line; the placed guide runs parallel to it. */
  dir: Point
  /** Unit normal the drag is signed along: the way the recorded offset grows. */
  outward: Point
  /**
   * The wall relation a commit records, when the base is wall-anchored: the
   * drag adds to `baseOffsetIn` and the placement inherits the anchor, so it
   * follows the wall exactly like the surface or guide it was measured from.
   * A base with no relation commits a free parallel instead.
   */
  surface: { relation: SurfaceRelation; baseOffsetIn: number } | null
}

/**
 * The placement in progress. The first click decides what is AVAILABLE — a
 * parallel base, a point anchor, or neither — and `form` says which of the two
 * is being placed right now, which is the only thing Tab changes (spec S9).
 */
interface Pending {
  form: PendingForm
  /** The first click's snapped point. */
  start: Point
  /** The line a parallel placement measures from, when the click captured one. */
  base: ParallelBase | null
  /** The form Tab returns to from a parallel: an angle, or the free tape. */
  pointForm: Exclude<PendingForm, 'offset'>
  /** The wall end an angle placement anchors to; without one it commits a free guide. */
  anchor: WallEndRef | null
}

/**
 * Tape measure and guide placement (spec S9): the tool measures, and a guide is
 * the byproduct of where the two clicks land. The FIRST click classifies —
 * a wall surface starts an offset placement parallel to it, an existing guide's
 * line does the same measured from that guide, a wall corner or surface
 * terminus starts an angle placement anchored to that point, empty space starts
 * a free one — the cursor then drags the value with a live chip, a typed value
 * (feet-inches for an offset, degrees for an angle) sets it exactly, Tab swaps
 * between the parallel and through-point forms where the capture offers both,
 * and Escape abandons the placement, leaving only the reading.
 *
 * Headless by design: all inputs are injected (snap engine, walls, guides,
 * commit callback) and interaction arrives via methods, so the machine is
 * testable without a DOM or a component tree.
 */
export function useTapeTool(options: UseTapeToolOptions): UseTapeToolReturn {
  const { snapping, walls, guides, commit } = options

  const pending: ShallowRef<Pending | null> = shallowRef(null)
  const cursor: ShallowRef<Point | null> = shallowRef(null)
  const altHeld = ref(false)
  const inputBuffer = ref('')

  const isMeasuring = computed(() => pending.value !== null)

  const currentSnap = computed<SnapResult | null>(() => {
    if (!cursor.value) return null
    return snapping.resolve(cursor.value, null, altHeld.value)
  })

  const preview = computed<TapeToolPreview | null>(() => {
    const current = pending.value
    const snap = currentSnap.value
    if (!current && !snap) return null

    const point = snap?.point ?? null
    const marker = snap?.marker && point ? { kind: snap.marker, point } : null
    if (!current) {
      return {
        mode: 'idle',
        start: null,
        point,
        line: null,
        chip: null,
        measurement: null,
        marker,
      }
    }

    const at = point ?? current.start
    const precision = options.displayPrecisionIn?.value
    const base = parallelBaseOf(current)
    if (base) {
      const offsetIn = offsetAt(base, at)
      return {
        mode: 'offset',
        start: current.start,
        point,
        line: offsetLine(base, offsetIn),
        chip: { at, text: formatFeetInches(Math.abs(offsetIn), precision), secondary: null },
        measurement: null,
        marker,
      }
    }

    const dir = directionTo(current.start, point)
    const angleText = formatAngleDeg(angleOf(dir) * RAD_TO_DEG)
    const line = { point: current.start, dir }
    if (current.form === 'angle') {
      return {
        mode: 'angle',
        start: current.start,
        point,
        line,
        chip: { at, text: angleText, secondary: null },
        measurement: null,
        marker,
      }
    }
    // Free mode is the pure measuring tape: the distance is the headline and the
    // angle rides along as the secondary reading (spec S9).
    const measurement = formatFeetInches(distance(current.start, at), precision)
    return {
      mode: 'free',
      start: current.start,
      point,
      line,
      chip: { at, text: measurement, secondary: angleText },
      measurement,
      marker,
    }
  })

  function setCursor(point: Point | null): void {
    cursor.value = point ? { ...point } : null
  }

  function setAlt(held: boolean): void {
    altHeld.value = held
  }

  /**
   * The pending line's direction: angle-snapped to the eight global directions
   * unless Alt frees it (spec S1). A drag with no extent yet keeps the default
   * direction rather than collapsing, so what the preview shows is what a
   * commit at that moment records.
   */
  function directionTo(start: Point, point: Point | null): Point {
    if (!point) return DEFAULT_DIRECTION
    const dir = snapping.direction(start, point, altHeld.value)
    if (dir.x === 0 && dir.y === 0) return DEFAULT_DIRECTION
    return dir
  }

  /** The base a placement is measuring from right now, or `null` in a point form. */
  function parallelBaseOf(current: Pending): ParallelBase | null {
    return current.form === 'offset' ? current.base : null
  }

  /** Signed perpendicular distance from the base line to `point`, positive outward. */
  function offsetAt(base: ParallelBase, point: Point): number {
    return dot(sub(point, base.point), base.outward)
  }

  function offsetLine(base: ParallelBase, offsetIn: number): { point: Point; dir: Point } {
    return { point: add(base.point, scale(base.outward, offsetIn)), dir: base.dir }
  }

  /**
   * The clicked surface as a base line, resolved through a zero-offset guide on
   * that very relation — so the offset the user drags is measured from the exact
   * line the committed guide will resolve to, whatever the wall's reference side
   * and thickness do to it.
   */
  function surfaceBase(target: Extract<SnapTarget, { kind: 'surface' }>): ParallelBase | null {
    const relation: SurfaceRelation = {
      wall_id: target.wallId,
      segment_index: target.segmentIndex,
      side: target.side,
    }
    const line = resolveGuideLine(
      { id: PENDING_GUIDE_ID, kind: 'surface', ...relation, offset_in: 0 },
      walls.value,
    )
    if (!line) return null
    // A surface guide displaces along the segment's left normal on the left side
    // and against it on the right, which is what makes `offset_in` grow away
    // from the body either way (`guideLine.ts`).
    const normal = perpendicular(line.dir)
    return {
      point: line.point,
      dir: line.dir,
      outward: target.side === 'left' ? normal : scale(normal, -1),
      surface: { relation, baseOffsetIn: 0 },
    }
  }

  /**
   * A clicked guide as a base line (spec S9): clicking a guide measures FROM it,
   * and the placement inherits what that guide is anchored to — a wall-anchored
   * source hands down its relation, so the new guide follows the wall too.
   *
   * `null` for a stale id, whose guide has left the document since the snap
   * engine saw it; the click then measures from the point like any other.
   */
  function guideBase(guideId: string): ParallelBase | null {
    const source = guides.value.find((guide) => guide.id === guideId)
    if (!source) return null
    const line = resolveGuideLine(source, walls.value)
    if (!line) return null
    if (source.kind !== 'surface') {
      return { point: line.point, dir: line.dir, outward: perpendicular(line.dir), surface: null }
    }
    // The source's own offset axis, read off the resolver by resolving the same
    // guide 1" further out: the wall's reference side and drawing direction
    // already decided which way its `offset_in` grows, and deriving that again
    // here would be a second copy of the rule, free to disagree.
    const shifted = resolveGuideLine({ ...source, offset_in: source.offset_in + 1 }, walls.value)
    if (!shifted) return null
    const outward = normalize(sub(shifted.point, line.point))
    if (outward.x === 0 && outward.y === 0) return null
    return {
      point: line.point,
      dir: line.dir,
      outward,
      surface: {
        relation: {
          wall_id: source.wall_id,
          segment_index: source.segment_index,
          side: source.side,
        },
        baseOffsetIn: source.offset_in,
      },
    }
  }

  /** Classifies the first click: what it captured decides what is being measured (spec S9). */
  function begin(snap: SnapResult): void {
    const start = { ...snap.point }
    const target = snap.target
    if (target?.kind === 'surface') {
      const base = surfaceBase(target)
      // An unresolvable surface (a degenerate segment) leaves nothing to be
      // parallel to, so the click measures from the point instead.
      if (base) {
        pending.value = { form: 'offset', start, base, pointForm: 'angle', anchor: null }
        return
      }
    } else if (target?.kind === 'wall-end' || target?.kind === 'surface-end') {
      // A guide through a point has no side: both surfaces of a captured
      // terminus belong to the same wall end.
      pending.value = {
        form: 'angle',
        start,
        base: null,
        pointForm: 'angle',
        anchor: { wall_id: target.wallId, end: target.end },
      }
      return
    } else if (snap.guideId) {
      // A captured guide (spec S9): its LINE is a direction to measure from, so
      // the click starts a parallel; a crossing is a position, and measures from
      // the point as before — Tab still turns it parallel to the guide it crosses.
      const base = guideBase(snap.guideId)
      if (base) {
        const onLine = snap.guideHit === 'line'
        pending.value = {
          form: onLine ? 'offset' : 'free',
          start,
          base,
          pointForm: onLine ? 'angle' : 'free',
          anchor: null,
        }
        return
      }
    }
    pending.value = { form: 'free', start, base: null, pointForm: 'free', anchor: null }
  }

  /**
   * The guide a pending placement commits to. `value` is the placed quantity in
   * the current form's own unit: inches of offset, or degrees of angle.
   */
  function guideOf(current: Pending, value: number): Guide {
    const id = crypto.randomUUID()
    const base = parallelBaseOf(current)
    if (base) {
      if (base.surface) {
        const { relation, baseOffsetIn } = base.surface
        return { id, kind: 'surface', ...relation, offset_in: baseOffsetIn + value }
      }
      // A parallel measured from an unanchored guide has no wall to follow, so
      // it records the line itself: the dragged-to line, at the source's angle.
      return {
        id,
        kind: 'free',
        origin: add(base.point, scale(base.outward, value)),
        angle_deg: angleOf(base.dir) * RAD_TO_DEG,
      }
    }
    if (current.anchor)
      return { id, kind: 'point', anchor: { ...current.anchor }, angle_deg: value }
    return { id, kind: 'free', origin: { ...current.start }, angle_deg: value }
  }

  /** The quantity the preview is showing for `point` — what a commit takes as-is. */
  function draggedValue(current: Pending, point: Point | null): number {
    const base = parallelBaseOf(current)
    if (base) return offsetAt(base, point ?? current.start)
    return angleOf(directionTo(current.start, point)) * RAD_TO_DEG
  }

  /**
   * The typed quantity, or `null` when the buffer does not parse — in which case
   * the buffer is kept and nothing is placed (spec S2).
   *
   * An offset is typed as a magnitude: the buffer holds no sign, so the side the
   * cursor was dragged to decides the direction, exactly as a typed wall length
   * runs along the dragged direction.
   */
  function typedValue(current: Pending, point: Point | null): number | null {
    if (inputBuffer.value === '') return null
    const base = parallelBaseOf(current)
    if (base) {
      const magnitude = parseFeetInches(inputBuffer.value)
      if (magnitude === null || magnitude < 0) return null
      return offsetAt(base, point ?? current.start) < 0 ? -magnitude : magnitude
    }
    const degrees = Number(inputBuffer.value)
    return Number.isFinite(degrees) ? degrees : null
  }

  /**
   * Tab: swaps the pending guide between its parallel form and its
   * through-point form (spec S9). Only a capture with a parallel base has two
   * forms to swap; without one there is nothing to toggle and the key is left
   * to the caller.
   */
  function toggleForm(): boolean {
    const current = pending.value
    if (!current?.base) return false
    pending.value = { ...current, form: current.form === 'offset' ? current.pointForm : 'offset' }
    // The forms take different units — feet-inches and degrees — so a
    // half-typed value must not survive the swap (spec S2).
    inputBuffer.value = ''
    return true
  }

  function place(value: number): void {
    const current = pending.value
    if (!current) return
    commit(guideOf(current, value))
    reset()
  }

  function onClick(world: Point): void {
    const snap = snapping.resolve(world, null, altHeld.value)
    const current = pending.value
    if (!current) {
      begin(snap)
      return
    }
    place(draggedValue(current, snap.point))
  }

  function handleKey(key: string): boolean {
    if (key === 'Alt') {
      altHeld.value = true
      return true
    }
    if (key === 'Tab') return toggleForm()
    const current = pending.value
    if (key === 'Escape') {
      if (inputBuffer.value !== '') {
        inputBuffer.value = ''
        return true
      }
      if (!current) return false
      cancel()
      return true
    }
    if (key === 'Enter') {
      if (!current) return false
      if (inputBuffer.value === '') {
        place(draggedValue(current, currentSnap.value?.point ?? null))
        return true
      }
      const typed = typedValue(current, currentSnap.value?.point ?? null)
      if (typed !== null) place(typed)
      return true
    }
    if (key === 'Backspace') {
      if (inputBuffer.value === '') return false
      inputBuffer.value = inputBuffer.value.slice(0, -1)
      return true
    }
    if (!current) return false
    if (current.form === 'offset') {
      if (!isBufferKey(key)) return false
      if (key === ' ' && inputBuffer.value === '') return false
    } else if (!ANGLE_CHAR_PATTERN.test(key)) {
      return false
    }
    inputBuffer.value += key
    return true
  }

  function reset(): void {
    pending.value = null
    inputBuffer.value = ''
  }

  function cancel(): void {
    reset()
  }

  function deactivate(): void {
    reset()
    altHeld.value = false
    cursor.value = null
  }

  return {
    preview,
    inputBuffer,
    isMeasuring,
    setCursor,
    setAlt,
    onClick,
    handleKey,
    cancel,
    deactivate,
  }
}

/** Degrees at one decimal with a trailing `.0` dropped: `0°`, `22.5°`, `-45°`. */
function formatAngleDeg(degrees: number): string {
  return `${Number(degrees.toFixed(ANGLE_DECIMALS))}°`
}
