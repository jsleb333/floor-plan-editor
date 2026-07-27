import { computed, ref, shallowRef, watch } from 'vue'
import type { ComputedRef, Ref, ShallowRef, WritableComputedRef } from 'vue'

import type { DoorStyle, Opening, Point, Wall } from '@/types/plan'
import { doorStyleControls, doorStyleDefaultWidthIn, isDoorStyle } from '@/utils/doorStyles'
import type { DoorStyleControls } from '@/utils/doorStyles'
import { clampOpeningT, projectOntoWalls, sideOf, wallSegmentSpan } from '@/utils/geometry'
import type { WallSegmentSpan } from '@/utils/geometry'
import { parseFeetInches } from '@/utils/units'

import { isBufferKey } from './useWallTool'

/** Default door width (spec S4): the common Québec residential interior door. */
export const DEFAULT_DOOR_WIDTH_IN = 30
/** Default window width (spec S5). */
export const DEFAULT_WINDOW_WIDTH_IN = 36
/** Capture radius (screen px) for hovering a host wall. */
const PLACEMENT_RADIUS_PX = 16
/** Placeholder id of the preview opening (never committed). */
const PREVIEW_ID = 'opening-preview'
/** localStorage key of the last-used door/window options (spec §5.9 tier 1). */
const STORAGE_KEY = 'floor-plan:opening-tool-options'

type Hinge = Opening['hinge']
type Swing = Opening['swing']

/** Last-used tool options persisted across sessions (specs S4/S5, §5.9 tier 1). */
interface StoredOpeningOptions {
  doorWidthIn: number
  doorStyle: DoorStyle
  doorHinge: Hinge
  doorSwing: Swing
  windowWidthIn: number
}

function isValidWidth(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function readStored(): StoredOpeningOptions {
  const defaults: StoredOpeningOptions = {
    doorWidthIn: DEFAULT_DOOR_WIDTH_IN,
    doorStyle: 'swing',
    doorHinge: 'left',
    doorSwing: 'in',
    windowWidthIn: DEFAULT_WINDOW_WIDTH_IN,
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return defaults
    const record = parsed as Partial<Record<keyof StoredOpeningOptions, unknown>>
    return {
      doorWidthIn: isValidWidth(record.doorWidthIn) ? record.doorWidthIn : defaults.doorWidthIn,
      doorStyle: isDoorStyle(record.doorStyle) ? record.doorStyle : defaults.doorStyle,
      doorHinge: record.doorHinge === 'right' ? 'right' : 'left',
      doorSwing: record.doorSwing === 'out' ? 'out' : 'in',
      windowWidthIn: isValidWidth(record.windowWidthIn)
        ? record.windowWidthIn
        : defaults.windowWidthIn,
    }
  } catch {
    return defaults
  }
}

export interface UseOpeningToolOptions {
  /** Kind of opening the tool places; follows the active tool (door/window). */
  kind: Ref<'door' | 'window'>
  /** Existing walls to host openings. */
  walls: Ref<readonly Wall[]>
  /** Current screen pixels per world inch, to convert the capture radius. */
  pixelsPerInch: Ref<number>
  /** Receives each placed opening; the caller dispatches the store command. */
  commit: (opening: Opening) => void
}

export interface UseOpeningToolReturn {
  /** The opening the next click would place, derived from the hovered wall. */
  preview: ComputedRef<Opening | null>
  /** Width the next opening is placed with, per kind (writable, spec E8). */
  widthIn: WritableComputedRef<number>
  /**
   * Leaf style of the next door — swing, double, sliding, bifold, double bifold
   * or pocket (spec S4).
   */
  style: Ref<DoorStyle>
  /** Hinge side of the next door; Tab cycles it while hovering (spec S4). */
  hinge: Ref<Hinge>
  /**
   * Swing of the next door: the cursor's side of the hovered wall while
   * hovering, else the last-used value; writing records a new last-used
   * value which the cursor overrides again (spec S4). Styles that ignore the
   * swing side (sliding, pocket) keep the last-used value untouched.
   */
  swing: WritableComputedRef<Swing>
  /** Typed exact-width buffer, echoed in the status bar (specs S2/S5). */
  inputBuffer: Ref<string>
  setWidth: (widthIn: number) => void
  /** Arms a door style, applying the width it implies when it has one (spec S4). */
  setStyle: (style: DoorStyle) => void
  setHinge: (hinge: Hinge) => void
  setSwing: (swing: Swing) => void
  setCursor: (point: Point | null) => void
  onClick: (world: Point) => void
  /**
   * Routes a key press to the tool; returns true when consumed (the caller
   * must then preventDefault/stopPropagation). Tab cycles the door hinge (a
   * no-op for styles that ignore it, e.g. double); digits/Enter/Backspace/
   * Escape drive the typed-width buffer.
   */
  handleKey: (key: string) => boolean
  /** Clears the hover state and typed buffer (on tool switch). */
  deactivate: () => void
}

/**
 * Door/window placement tool (specs S4/S5/E8): hovering projects the cursor
 * onto the nearest wall reference line and previews the opening centred at
 * that attachment; clicking commits it with the parametric host address
 * (§4.2). Width, style, hinge and swing are live tool options: the ghost
 * reflects them, the cursor's side of the wall drives a door's swing, Tab
 * cycles the hinge, typed digits set the width exactly, and the options
 * persist as last-used per kind (§5.9 tier 1). The armed style decides which
 * side fields it reads (`doorStyleControls`), and the cursor/Tab gestures do
 * nothing for a field the style ignores rather than writing a dead value; a
 * style that implies a width (`doorStyleDefaultWidthIn`) applies it when armed.
 *
 * Headless by design: all inputs are injected and interaction arrives via
 * methods, so the machine is testable without a DOM.
 */
export function useOpeningTool(options: UseOpeningToolOptions): UseOpeningToolReturn {
  const { kind, walls, pixelsPerInch, commit } = options

  const stored = readStored()
  const doorWidthIn = ref(stored.doorWidthIn)
  const windowWidthIn = ref(stored.windowWidthIn)
  const style = ref<DoorStyle>(stored.doorStyle)
  const hinge = ref<Hinge>(stored.doorHinge)
  /** Swing used when the cursor doesn't decide: options-toggle clicks and commits record it. */
  const lastSwing = ref<Swing>(stored.doorSwing)
  const inputBuffer = ref('')
  const cursor: ShallowRef<Point | null> = shallowRef(null)

  watch([doorWidthIn, windowWidthIn, style, hinge, lastSwing], () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        doorWidthIn: doorWidthIn.value,
        doorStyle: style.value,
        doorHinge: hinge.value,
        doorSwing: lastSwing.value,
        windowWidthIn: windowWidthIn.value,
      } satisfies StoredOpeningOptions),
    )
  })

  const widthIn = computed<number>({
    get: () => (kind.value === 'door' ? doorWidthIn.value : windowWidthIn.value),
    set: (value) => setWidth(value),
  })

  function setWidth(value: number): void {
    if (!isValidWidth(value)) return
    if (kind.value === 'door') doorWidthIn.value = value
    else windowWidthIn.value = value
  }

  function setStyle(value: DoorStyle): void {
    style.value = value
    // A style that implies a width applies it on selection (spec S4): a double
    // bifold is a 60" closet front, so its default is one click away instead of
    // a second trip to the width field. Deliberate trade-off — picking the style
    // is the later, more specific intent, so it overwrites a width typed just
    // before it; retyping the width afterwards still wins, and the applied width
    // becomes the last-used door width like any other (§5.9 tier 1).
    const styleWidthIn = doorStyleDefaultWidthIn(value)
    if (styleWidthIn !== null) doorWidthIn.value = styleWidthIn
  }

  function setHinge(value: Hinge): void {
    hinge.value = value
  }

  function setSwing(value: Swing): void {
    lastSwing.value = value
  }

  /** The side fields the armed door style reads (spec S4). */
  function armedControls(): DoorStyleControls {
    return doorStyleControls(style.value)
  }

  function thresholdIn(): number {
    return PLACEMENT_RADIUS_PX / Math.max(pixelsPerInch.value, Number.EPSILON)
  }

  /**
   * Swing implied by the side of the host segment `world` is on: 'in' swings
   * toward the left of the segment's travel direction (`doorFigure`
   * convention), and `sideOf` reports that same left, so the leaf always
   * renders toward the cursor (spec S4). A style that ignores the swing side
   * keeps the last-used value instead.
   */
  function swingAt(span: WallSegmentSpan, world: Point): Swing {
    if (armedControls().swing === null) return lastSwing.value
    const side = sideOf(span.a, span.b, world)
    if (side === 'on') return lastSwing.value
    return side === 'left' ? 'in' : 'out'
  }

  function openingAt(world: Point): Opening | null {
    const placement = projectOntoWalls(world, walls.value, thresholdIn())
    if (!placement) return null
    const wall = walls.value.find((candidate) => candidate.id === placement.wallId)
    if (!wall) return null
    const span = wallSegmentSpan(wall, placement.segmentIndex)
    if (!span || span.lengthIn <= 0) return null
    const isDoor = kind.value === 'door'
    return {
      id: PREVIEW_ID,
      kind: kind.value,
      wall_id: placement.wallId,
      segment_index: placement.segmentIndex,
      t: clampOpeningT(placement.tIn, widthIn.value, span.lengthIn),
      width_in: widthIn.value,
      style: isDoor ? style.value : 'swing',
      hinge: isDoor ? hinge.value : 'left',
      swing: isDoor ? swingAt(span, world) : 'in',
    }
  }

  const preview = computed<Opening | null>(() => (cursor.value ? openingAt(cursor.value) : null))

  const swing = computed<Swing>({
    get: () => (kind.value === 'door' && preview.value ? preview.value.swing : lastSwing.value),
    set: (value) => setSwing(value),
  })

  function setCursor(point: Point | null): void {
    cursor.value = point ? { ...point } : null
  }

  function onClick(world: Point): void {
    const opening = openingAt(world)
    if (!opening) return
    if (opening.kind === 'door' && armedControls().swing !== null) {
      lastSwing.value = opening.swing
    }
    commit({ ...opening, id: crypto.randomUUID() })
  }

  function applyTypedWidth(): void {
    const parsed = parseFeetInches(inputBuffer.value)
    if (parsed === null || parsed <= 0) return
    setWidth(parsed)
    inputBuffer.value = ''
  }

  function handleKey(key: string): boolean {
    if (key === 'Tab') {
      if (kind.value !== 'door') return false
      // Consumed either way so focus stays on the canvas, but a style that has
      // no hinge side (double) gets no dead value written to it (spec S4).
      if (armedControls().hinge !== null) {
        hinge.value = hinge.value === 'left' ? 'right' : 'left'
      }
      return true
    }
    if (key === 'Escape') {
      if (inputBuffer.value === '') return false
      inputBuffer.value = ''
      return true
    }
    if (key === 'Enter') {
      if (inputBuffer.value === '') return false
      applyTypedWidth()
      return true
    }
    if (key === 'Backspace') {
      if (inputBuffer.value === '') return false
      inputBuffer.value = inputBuffer.value.slice(0, -1)
      return true
    }
    // Typed digits set the width exactly while hovering a wall (specs S4/S5).
    if (isBufferKey(key) && preview.value !== null) {
      if (key === ' ' && inputBuffer.value === '') return false
      inputBuffer.value += key
      return true
    }
    return false
  }

  function deactivate(): void {
    cursor.value = null
    inputBuffer.value = ''
  }

  return {
    preview,
    widthIn,
    style,
    hinge,
    swing,
    inputBuffer,
    setWidth,
    setStyle,
    setHinge,
    setSwing,
    setCursor,
    onClick,
    handleKey,
    deactivate,
  }
}
