import { computed, ref, shallowRef } from 'vue'
import type { ComputedRef, Ref, ShallowRef } from 'vue'

import type { Guide, Point, Wall, WallEndRef, WallSide } from '@/types/plan'
import {
  add,
  angleOf,
  distance,
  dot,
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
 * What the first click captured, which is what the tool measures (spec S9):
 * an offset from a wall surface, an angle through an anchored point, or a free
 * angle through a point anchored to nothing.
 */
export type TapeMode = 'idle' | 'offset' | 'angle' | 'free'

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
   * then preventDefault/stopPropagation). Handles Enter, Escape, Backspace, Alt
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

/** The clicked surface as a world line, plus which way a positive offset displaces it. */
interface PendingSurface {
  relation: SurfaceRelation
  /** A point on the surface itself — the zero-offset guide's own resolved point. */
  point: Point
  /** Unit direction of the surface, which is the host segment's direction. */
  dir: Point
  /** Unit normal a positive `offset_in` displaces along: away from the wall body. */
  outward: Point
}

/**
 * The placement in progress. Which variant it is was decided by the first
 * click and never changes: in S9 the plan content drives the tool.
 */
type Pending =
  | { mode: 'offset'; start: Point; surface: PendingSurface }
  | { mode: 'angle'; start: Point; anchor: WallEndRef }
  | { mode: 'free'; start: Point }

/**
 * Tape measure and guide placement (spec S9): the tool measures, and a guide is
 * the byproduct of where the two clicks land. The FIRST click classifies —
 * a wall surface starts an offset placement parallel to it, a wall corner or
 * surface terminus starts an angle placement anchored to that point, empty
 * space starts a free one — the cursor then drags the value with a live chip,
 * a typed value (feet-inches for an offset, degrees for an angle) sets it
 * exactly, and Escape abandons the placement, leaving only the reading.
 *
 * Headless by design: all inputs are injected (snap engine, walls, commit
 * callback) and interaction arrives via methods, so the machine is testable
 * without a DOM or a component tree.
 */
export function useTapeTool(options: UseTapeToolOptions): UseTapeToolReturn {
  const { snapping, walls, commit } = options

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
    if (current.mode === 'offset') {
      const offsetIn = offsetAt(current.surface, at)
      return {
        mode: 'offset',
        start: current.start,
        point,
        line: offsetLine(current.surface, offsetIn),
        chip: { at, text: formatFeetInches(Math.abs(offsetIn), precision), secondary: null },
        measurement: null,
        marker,
      }
    }

    const dir = directionTo(current.start, point)
    const angleText = formatAngleDeg(angleOf(dir) * RAD_TO_DEG)
    const line = { point: current.start, dir }
    if (current.mode === 'angle') {
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

  /** Signed perpendicular distance from the clicked surface to `point`, positive outward. */
  function offsetAt(surface: PendingSurface, point: Point): number {
    return dot(sub(point, surface.point), surface.outward)
  }

  function offsetLine(surface: PendingSurface, offsetIn: number): { point: Point; dir: Point } {
    return { point: add(surface.point, scale(surface.outward, offsetIn)), dir: surface.dir }
  }

  /**
   * The clicked surface as a line, resolved through a zero-offset guide on that
   * very relation — so the offset the user drags is measured from the exact line
   * the committed guide will resolve to, whatever the wall's reference side and
   * thickness do to it.
   */
  function pendingSurfaceOf(
    target: Extract<SnapTarget, { kind: 'surface' }>,
  ): PendingSurface | null {
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
      relation,
      point: line.point,
      dir: line.dir,
      outward: target.side === 'left' ? normal : scale(normal, -1),
    }
  }

  /** Classifies the first click: what it captured decides what is being measured (spec S9). */
  function begin(snap: SnapResult): void {
    const start = { ...snap.point }
    const target = snap.target
    if (target?.kind === 'surface') {
      const surface = pendingSurfaceOf(target)
      // An unresolvable surface (a degenerate segment) leaves nothing to be
      // parallel to, so the click measures from the point instead.
      if (surface) {
        pending.value = { mode: 'offset', start, surface }
        return
      }
    } else if (target?.kind === 'wall-end' || target?.kind === 'surface-end') {
      // A guide through a point has no side: both surfaces of a captured
      // terminus belong to the same wall end.
      pending.value = { mode: 'angle', start, anchor: { wall_id: target.wallId, end: target.end } }
      return
    }
    pending.value = { mode: 'free', start }
  }

  /**
   * The guide a pending placement commits to. `value` is the placed quantity in
   * that mode's own unit: inches of offset, or degrees of angle.
   */
  function guideOf(current: Pending, value: number): Guide {
    const id = crypto.randomUUID()
    switch (current.mode) {
      case 'offset':
        return { id, kind: 'surface', ...current.surface.relation, offset_in: value }
      case 'angle':
        return { id, kind: 'point', anchor: { ...current.anchor }, angle_deg: value }
      case 'free':
        return { id, kind: 'free', origin: { ...current.start }, angle_deg: value }
    }
  }

  /** The quantity the preview is showing for `point` — what a commit takes as-is. */
  function draggedValue(current: Pending, point: Point | null): number {
    if (current.mode === 'offset') return offsetAt(current.surface, point ?? current.start)
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
    if (current.mode === 'offset') {
      const magnitude = parseFeetInches(inputBuffer.value)
      if (magnitude === null || magnitude < 0) return null
      return offsetAt(current.surface, point ?? current.start) < 0 ? -magnitude : magnitude
    }
    const degrees = Number(inputBuffer.value)
    return Number.isFinite(degrees) ? degrees : null
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
    if (current.mode === 'offset') {
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
