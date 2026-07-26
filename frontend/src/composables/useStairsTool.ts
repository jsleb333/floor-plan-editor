import { computed, ref, shallowRef, watch } from 'vue'
import type { ComputedRef, Ref, ShallowRef } from 'vue'

import type { Point, Stairs } from '@/types/plan'
import { angleOf, dot, sub } from '@/utils/geometry'
import { parseFeetInches } from '@/utils/units'

import { GRID_STEP_IN } from './useSnapping'
import type { UseSnappingReturn } from './useSnapping'
import { isBufferKey } from './useWallTool'

/** Default stair run width (spec S6), editable in the Inspector afterwards. */
export const DEFAULT_STAIRS_WIDTH_IN = 36
/** Hover-ghost run length until a run has been placed (spec S6). */
export const DEFAULT_STAIRS_LENGTH_IN = 120
/** Drags shorter than this commit nothing (an accidental click, not a run). */
const MIN_STAIRS_LENGTH_IN = 12
/** Placeholder id of the preview run (never committed). */
const PREVIEW_ID = 'stairs-preview'
/** localStorage key of the last-used stairs options (spec §5.9 tier 1). */
const STORAGE_KEY = 'floor-plan:stairs-tool-options'

const RAD_TO_DEG = 180 / Math.PI

type StairsDirection = Stairs['direction']

/** Last-used tool options persisted across sessions (specs S6, §5.9 tier 1). */
interface StoredStairsOptions {
  widthIn: number
  direction: StairsDirection
  lengthIn: number
}

function isValidLength(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function readStored(): StoredStairsOptions {
  const defaults: StoredStairsOptions = {
    widthIn: DEFAULT_STAIRS_WIDTH_IN,
    direction: 'up',
    lengthIn: DEFAULT_STAIRS_LENGTH_IN,
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return defaults
    const record = parsed as Partial<Record<keyof StoredStairsOptions, unknown>>
    return {
      widthIn: isValidLength(record.widthIn) ? record.widthIn : defaults.widthIn,
      direction: record.direction === 'down' ? 'down' : 'up',
      lengthIn: isValidLength(record.lengthIn) ? record.lengthIn : defaults.lengthIn,
    }
  } catch {
    return defaults
  }
}

export interface UseStairsToolOptions {
  /** Shared snap engine; provides the snap settings and point resolution. */
  snapping: UseSnappingReturn
  /** Receives each finished stair run; the caller dispatches the store command. */
  commit: (stairs: Stairs) => void
}

export interface UseStairsToolReturn {
  /**
   * The run the layer previews: the hover ghost at the cursor before any
   * press (options width, last-used length, horizontal), the pending drag
   * afterwards (spec S6/E8).
   */
  preview: ComputedRef<Stairs | null>
  isDrawing: ComputedRef<boolean>
  /** Width the next run is placed with (live tool option, spec E8). */
  widthIn: Ref<number>
  /** Direction label of the next run; Tab flips it while the tool is armed (spec S6). */
  direction: Ref<StairsDirection>
  /** Typed exact-length buffer while dragging, echoed in the status bar (spec S2). */
  inputBuffer: Ref<string>
  setWidth: (widthIn: number) => void
  setDirection: (direction: StairsDirection) => void
  setCursor: (point: Point | null) => void
  setAlt: (held: boolean) => void
  onPress: (world: Point) => void
  onRelease: (world: Point) => void
  /**
   * Routes a key press to the tool; returns true when consumed (the caller
   * must then preventDefault/stopPropagation). Tab flips the direction;
   * digits/Enter/Backspace drive the typed-length buffer while dragging;
   * Escape clears the buffer first, then cancels the pending drag (spec E4).
   */
  handleKey: (key: string) => boolean
  /** Cancels the pending drag and clears modifier/buffer state (on tool switch). */
  deactivate: () => void
}

/**
 * Stairs drawing tool (spec S6): a ghost run previews at the cursor before
 * any press, then press sets the origin corner, drag sets the run direction
 * (angle-snapped) and length, release commits. Width and direction are live
 * tool options persisted as last-used (§5.9 tier 1); Tab flips the direction
 * at any point, and a length typed while dragging places the far end exactly
 * on Enter (spec S2 semantics).
 *
 * Headless by design: all inputs are injected and interaction arrives via
 * methods, so the machine is testable without a DOM.
 */
export function useStairsTool(options: UseStairsToolOptions): UseStairsToolReturn {
  const { snapping, commit } = options

  const stored = readStored()
  const widthIn = ref(stored.widthIn)
  const direction = ref<StairsDirection>(stored.direction)
  /** Run length of the hover ghost — the most recently committed length. */
  const lastLengthIn = ref(stored.lengthIn)
  const inputBuffer = ref('')
  const origin: ShallowRef<Point | null> = shallowRef(null)
  const cursor: ShallowRef<Point | null> = shallowRef(null)
  const altHeld = ref(false)

  watch([widthIn, direction, lastLengthIn], () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        widthIn: widthIn.value,
        direction: direction.value,
        lengthIn: lastLengthIn.value,
      } satisfies StoredStairsOptions),
    )
  })

  const isDrawing = computed(() => origin.value !== null)

  function pendingRun(world: Point): Stairs | null {
    const from = origin.value
    if (!from) return null
    const runDirection = snapping.direction(from, world, altHeld.value)
    if (runDirection.x === 0 && runDirection.y === 0) return null
    let lengthIn = Math.max(dot(sub(world, from), runDirection), 0)
    if (snapping.settings.grid.value) {
      lengthIn = Math.round(lengthIn / GRID_STEP_IN) * GRID_STEP_IN
    }
    if (lengthIn <= 0) return null
    return {
      id: PREVIEW_ID,
      origin: { ...from },
      width_in: widthIn.value,
      length_in: lengthIn,
      rotation_deg: angleOf(runDirection) * RAD_TO_DEG,
      direction: direction.value,
    }
  }

  /**
   * Ghost run before any press (spec S6): anchored so the cursor sits where a
   * press would put the origin, horizontal, with the options width and the
   * last-used length.
   */
  function hoverGhost(world: Point): Stairs {
    const anchor = snapping.resolve(world, null, altHeld.value).point
    return {
      id: PREVIEW_ID,
      origin: { ...anchor },
      width_in: widthIn.value,
      length_in: lastLengthIn.value,
      rotation_deg: 0,
      direction: direction.value,
    }
  }

  const preview = computed<Stairs | null>(() => {
    if (!cursor.value) return null
    return origin.value ? pendingRun(cursor.value) : hoverGhost(cursor.value)
  })

  function setWidth(value: number): void {
    if (isValidLength(value)) widthIn.value = value
  }

  function setDirection(value: StairsDirection): void {
    direction.value = value
  }

  function setCursor(point: Point | null): void {
    cursor.value = point ? { ...point } : null
  }

  function setAlt(held: boolean): void {
    altHeld.value = held
  }

  function onPress(world: Point): void {
    origin.value = { ...snapping.resolve(world, null, altHeld.value).point }
  }

  function commitRun(run: Stairs): void {
    commit({ ...run, id: crypto.randomUUID() })
    lastLengthIn.value = run.length_in
  }

  function onRelease(world: Point): void {
    const run = pendingRun(world)
    origin.value = null
    inputBuffer.value = ''
    if (!run || run.length_in < MIN_STAIRS_LENGTH_IN) return
    commitRun(run)
  }

  /**
   * Enter with a typed length: the far end lands exactly that far from the
   * origin along the current snapped drag direction (spec S2 semantics), and
   * the run commits immediately.
   */
  function commitTypedLength(): void {
    const from = origin.value
    const target = cursor.value
    if (!from || !target) return
    const lengthIn = parseFeetInches(inputBuffer.value)
    if (lengthIn === null || lengthIn <= 0) return
    const runDirection = snapping.direction(from, target, altHeld.value)
    if (runDirection.x === 0 && runDirection.y === 0) return
    inputBuffer.value = ''
    origin.value = null
    commitRun({
      id: PREVIEW_ID,
      origin: { ...from },
      width_in: widthIn.value,
      length_in: lengthIn,
      rotation_deg: angleOf(runDirection) * RAD_TO_DEG,
      direction: direction.value,
    })
  }

  function handleKey(key: string): boolean {
    if (key === 'Alt') {
      altHeld.value = true
      return isDrawing.value
    }
    if (key === 'Tab') {
      direction.value = direction.value === 'up' ? 'down' : 'up'
      return true
    }
    if (key === 'Escape') {
      if (inputBuffer.value !== '') {
        inputBuffer.value = ''
        return true
      }
      if (origin.value) {
        origin.value = null
        return true
      }
      return false
    }
    if (key === 'Enter') {
      if (inputBuffer.value === '') return false
      commitTypedLength()
      return true
    }
    if (key === 'Backspace') {
      if (inputBuffer.value === '') return false
      inputBuffer.value = inputBuffer.value.slice(0, -1)
      return true
    }
    // Typed digits buffer an exact run length while dragging (specs S6/S2).
    if (isBufferKey(key) && isDrawing.value) {
      if (key === ' ' && inputBuffer.value === '') return false
      inputBuffer.value += key
      return true
    }
    return false
  }

  function deactivate(): void {
    origin.value = null
    cursor.value = null
    altHeld.value = false
    inputBuffer.value = ''
  }

  return {
    preview,
    isDrawing,
    widthIn,
    direction,
    inputBuffer,
    setWidth,
    setDirection,
    setCursor,
    setAlt,
    onPress,
    onRelease,
    handleKey,
    deactivate,
  }
}
