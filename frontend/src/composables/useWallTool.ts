import { computed, shallowRef, ref } from 'vue'
import type { ComputedRef, Ref, ShallowRef } from 'vue'

import type { Point, Wall, WallEndAttachment } from '@/types/plan'
import {
  EPSILON,
  add,
  alignedClose,
  autoSquareClose,
  distance,
  scale,
  wallOutline,
} from '@/utils/geometry'
import type { AlignmentGuide, WallReference } from '@/utils/geometry'
import { formatFeetInches, parseFeetInches } from '@/utils/units'

import type {
  SnapChainContext,
  SnapGuide,
  SnapMarkerKind,
  SnapResult,
  UseSnappingReturn,
  WallSnapAttachment,
} from './useSnapping'

/** Interior 3½" is the default thickness preset (spec S1). */
export const DEFAULT_WALL_THICKNESS_IN = 3.5
const THICKNESS_TOLERANCE_IN = 1e-9
const MIN_COMMIT_VERTICES = 2
const REFERENCE_CYCLE: readonly WallReference[] = ['center', 'left', 'right']
const BUFFER_CHAR_PATTERN = /^[0-9'"/. ]$/

/** True for single characters that belong to the exact-input buffer (spec S2). */
export function isBufferKey(key: string): boolean {
  return key === 'Backspace' || BUFFER_CHAR_PATTERN.test(key)
}

/** Everything the drawing overlay needs to visualize the pending wall (spec E6). */
export interface WallToolPreview {
  /** Vertices committed to the pending chain so far. */
  vertices: Point[]
  /** Snapped cursor position — the vertex the next click would place. */
  point: Point | null
  /** Pending segment from the last placed vertex to the snapped cursor. */
  segment: { a: Point; b: Point } | null
  /** Wall-body silhouette rings of the whole pending chain incl. the preview segment. */
  rings: Point[][]
  /** Live length of the pending segment, formatted for the on-canvas label. */
  lengthLabel: string | null
  marker: { kind: Exclude<SnapMarkerKind, 'close'>; point: Point } | null
  guide: SnapGuide | null
  /** Alignment line through the chain start when the pending point lines up with it (spec S1c). */
  alignGuide: SnapGuide | null
  /** Alignment guides through nearby geometry anchors when `point` snapped onto them (spec S1e). */
  alignmentGuides: readonly AlignmentGuide[]
  /** Chain-start point when the close-loop affordance is engaged (spec S1c). */
  closePoint: Point | null
  reference: WallReference
  thicknessIn: number
}

export interface UseWallToolOptions {
  /** Shared snap engine; also provides the snap settings and threshold. */
  snapping: UseSnappingReturn
  /** Receives each finished wall; the caller dispatches the store command. */
  commit: (wall: Wall) => void
  /**
   * Plan-level thickness presets driving the smart defaults (spec S1d).
   * Preset convention (spec §5.9 tier 2): the list is ordered from outermost
   * to innermost — the FIRST preset is the exterior wall preset and the LAST
   * is the interior default (seeded [12, 4.5, 3.5]: 12" exterior, 3.5"
   * interior default). Omitted or empty disables the smart preset flow.
   */
  presetsIn?: Ref<readonly number[]> | ComputedRef<readonly number[]>
  /** Whether the plan already contains a closed wall loop (spec S1d). */
  hasClosedLoop?: Ref<boolean> | ComputedRef<boolean>
  /** Notified when closing a loop auto-switches to the interior default (spec S1d). */
  onAutoPreset?: (thicknessIn: number) => void
  /** Display precision for the live length label (spec §5.9 tier 2); 1/8" when omitted. */
  displayPrecisionIn?: Ref<number> | ComputedRef<number>
}

export interface UseWallToolReturn {
  thicknessIn: Ref<number>
  reference: Ref<WallReference>
  inputBuffer: Ref<string>
  isDrawing: ComputedRef<boolean>
  preview: ComputedRef<WallToolPreview | null>
  setCursor: (point: Point | null) => void
  setAlt: (held: boolean) => void
  setThickness: (thicknessIn: number) => void
  setReference: (reference: WallReference) => void
  cycleReference: () => void
  onClick: (world: Point) => void
  onDoubleClick: () => void
  /**
   * Routes a key press to the tool; returns true when consumed (the caller
   * must then preventDefault/stopPropagation). Handles Enter, Escape, Tab,
   * Backspace, Alt and the exact-input buffer characters.
   */
  handleKey: (key: string) => boolean
  cancel: () => void
  /** Cancels the pending chain and clears modifier state (on tool switch). */
  deactivate: () => void
  /**
   * Applies the smart preset for arming (spec S1d): exterior preset while the
   * plan has no closed loop, interior default once one exists. Also clears
   * any explicit-pick override, re-enabling the loop-close auto-switch. Call
   * every time the wall tool becomes the active tool.
   */
  arm: () => void
}

/**
 * Wall drawing state machine (specs S1/S1a/S1c/S1d/S2): click to place
 * reference vertices, Enter/double-click to finish (a click landing on an
 * existing wall finishes there), Esc to cancel, Tab to cycle the reference
 * side, typed lengths for exact input, a close-loop affordance with
 * aligned-close correction and auto-square corner insertion, and the smart
 * thickness flow — exterior preset on an empty plan, interior default once a
 * loop exists or closes, always overridden by an explicit pick.
 *
 * Headless by design: all inputs are injected (snap engine, commit callback)
 * and interaction arrives via methods, so the machine is testable without a
 * DOM or a component tree.
 */
export function useWallTool(options: UseWallToolOptions): UseWallToolReturn {
  const { snapping, commit, onAutoPreset } = options
  const presetsIn = options.presetsIn ?? ref<readonly number[]>([])
  const hasClosedLoop = options.hasClosedLoop ?? ref(false)

  const thicknessIn = ref(DEFAULT_WALL_THICKNESS_IN)
  const reference = ref<WallReference>('center')
  const inputBuffer = ref('')
  const vertices: ShallowRef<Point[]> = shallowRef([])
  const cursor: ShallowRef<Point | null> = shallowRef(null)
  const altHeld = ref(false)

  let startAttachment: WallSnapAttachment | null = null
  let lastAttachment: WallSnapAttachment | null = null
  // Whether the user explicitly picked a thickness since the last arm; an
  // explicit pick always wins and suppresses the smart presets (spec S1d).
  let manualOverride = false

  const isDrawing = computed(() => vertices.value.length > 0)

  function chainContext(): SnapChainContext | null {
    const chain = vertices.value
    if (chain.length === 0) return null
    return { start: chain[0], last: chain[chain.length - 1], vertexCount: chain.length }
  }

  const currentSnap = computed<SnapResult | null>(() => {
    if (!cursor.value) return null
    return snapping.resolve(cursor.value, chainContext(), altHeld.value)
  })

  const preview = computed<WallToolPreview | null>(() => {
    const chain = vertices.value
    const snap = currentSnap.value
    if (chain.length === 0 && !snap) return null

    const point = snap?.point ?? null
    const last = chain.length > 0 ? chain[chain.length - 1] : null
    const segment = last && point ? { a: last, b: point } : null

    let previewChain = point ? [...chain, point] : chain
    if (snap?.marker === 'close') {
      previewChain = [...closingChain(chain), chain[0]]
    }
    const rings =
      previewChain.length >= 2
        ? wallOutline({
            vertices: previewChain,
            thicknessIn: thicknessIn.value,
            reference: reference.value,
          })
        : []

    return {
      vertices: chain,
      point,
      segment,
      rings,
      lengthLabel: segment
        ? formatFeetInches(distance(segment.a, segment.b), options.displayPrecisionIn?.value)
        : null,
      marker:
        snap && snap.marker && snap.marker !== 'close'
          ? { kind: snap.marker, point: snap.point }
          : null,
      guide: snap?.guide ?? null,
      alignGuide: snap?.alignGuide ?? null,
      alignmentGuides: snap?.alignmentGuides ?? [],
      closePoint: snap?.marker === 'close' ? snap.point : null,
      reference: reference.value,
      thicknessIn: thicknessIn.value,
    }
  })

  function setCursor(point: Point | null): void {
    cursor.value = point ? { ...point } : null
  }

  function setAlt(held: boolean): void {
    altHeld.value = held
  }

  function setThickness(value: number): void {
    if (value <= 0) return
    thicknessIn.value = value
    manualOverride = true
  }

  function arm(): void {
    manualOverride = false
    const presets = presetsIn.value
    if (presets.length === 0) return
    thicknessIn.value = hasClosedLoop.value ? presets[presets.length - 1] : presets[0]
  }

  /**
   * The loop-close switch (spec S1d): the moment a chain commit closes a loop,
   * the active exterior preset flips to the interior default — the next wall
   * is almost always a partition. Runs AFTER the wall is committed, so it only
   * ever affects the next wall; an explicit pick since arming, a non-exterior
   * active thickness or an exterior-only preset list leave everything alone.
   */
  function autoSelectInteriorPreset(): void {
    if (manualOverride) return
    const presets = presetsIn.value
    if (presets.length === 0) return
    const exterior = presets[0]
    const interior = presets[presets.length - 1]
    if (Math.abs(thicknessIn.value - exterior) > THICKNESS_TOLERANCE_IN) return
    if (Math.abs(interior - exterior) <= THICKNESS_TOLERANCE_IN) return
    thicknessIn.value = interior
    onAutoPreset?.(interior)
  }

  function setReference(value: WallReference): void {
    reference.value = value
  }

  function cycleReference(): void {
    const index = REFERENCE_CYCLE.indexOf(reference.value)
    reference.value = REFERENCE_CYCLE[(index + 1) % REFERENCE_CYCLE.length]
  }

  function pushVertex(point: Point, attachment: WallSnapAttachment | null): void {
    const chain = vertices.value
    const last = chain[chain.length - 1]
    if (last && distance(last, point) <= EPSILON) return
    if (chain.length === 0) startAttachment = attachment
    lastAttachment = attachment
    vertices.value = [...chain, { ...point }]
  }

  function onClick(world: Point): void {
    const snap = snapping.resolve(world, chainContext(), altHeld.value)
    if (snap.marker === 'close') {
      closeChain()
      return
    }
    pushVertex(snap.point, snap.attachment)
    // Landing on an existing wall terminates the chain there (spec S3a): the
    // wall has reached existing geometry, no explicit finish needed. The
    // remaining markers are all wall snaps ('close' returned above).
    if (snap.marker !== null && vertices.value.length >= MIN_COMMIT_VERTICES) {
      finish()
    }
  }

  function onDoubleClick(): void {
    const chain = vertices.value
    if (
      chain.length >= MIN_COMMIT_VERTICES &&
      distance(chain[chain.length - 1], chain[chain.length - 2]) <= snapping.thresholdIn()
    ) {
      // The second click of the double-click placed a stray vertex next to the
      // real chain end (only possible in free-draw); drop it before finishing.
      vertices.value = chain.slice(0, -1)
      lastAttachment = null
    }
    finish()
  }

  /**
   * Vertices of the chain adjusted for closing (spec S1c): a nearly-aligned
   * chain end is nudged onto the alignment line through the start for a
   * single exact closing segment; otherwise an auto-square corner is inserted
   * (angle snap on); Alt closes directly with the chain as placed.
   */
  function closingChain(chain: Point[]): Point[] {
    if (altHeld.value) return chain
    const start = chain[0]
    const last = chain[chain.length - 1]
    const aligned = alignedClose(chain[chain.length - 2], last, start, snapping.thresholdIn())
    if (aligned) return [...chain.slice(0, -1), aligned]
    if (!snapping.settings.angle.value) return chain
    const heading = snapping.direction(last, start, false)
    const solution = autoSquareClose(last, heading, start)
    return solution ? [...chain, solution.corner] : chain
  }

  function closeChain(): void {
    commitWall(closingChain(vertices.value), true)
  }

  function finish(): void {
    const chain = vertices.value
    if (chain.length >= MIN_COMMIT_VERTICES) {
      commitWall(chain, false)
    } else {
      reset()
    }
  }

  function commitWall(wallVertices: Point[], closed: boolean): void {
    const junctions: WallEndAttachment[] = []
    if (startAttachment) junctions.push(toJunction('start', startAttachment))
    if (!closed && lastAttachment) junctions.push(toJunction('end', lastAttachment))
    commit({
      id: crypto.randomUUID(),
      vertices: wallVertices.map((vertex) => ({ ...vertex })),
      thickness_in: thicknessIn.value,
      reference: reference.value,
      closed,
      locked_segments: [],
      junctions,
    })
    reset()
    if (closed) autoSelectInteriorPreset()
  }

  function commitTypedLength(): void {
    const chain = vertices.value
    const last = chain[chain.length - 1]
    if (!last) return
    const lengthIn = parseFeetInches(inputBuffer.value)
    if (lengthIn === null || lengthIn <= 0) return
    const target = currentSnap.value?.point ?? cursor.value
    if (!target) return
    const dir = snapping.direction(last, target, altHeld.value)
    if (Math.abs(dir.x) <= EPSILON && Math.abs(dir.y) <= EPSILON) return
    pushVertex(add(last, scale(dir, lengthIn)), null)
    inputBuffer.value = ''
  }

  function handleKey(key: string): boolean {
    if (key === 'Alt') {
      altHeld.value = true
      return true
    }
    if (key === 'Tab') {
      cycleReference()
      return true
    }
    if (key === 'Escape') {
      if (inputBuffer.value !== '') {
        inputBuffer.value = ''
        return true
      }
      if (vertices.value.length > 0) {
        cancel()
        return true
      }
      return false
    }
    if (key === 'Enter') {
      if (inputBuffer.value !== '') {
        commitTypedLength()
        return true
      }
      if (vertices.value.length > 0) {
        finish()
        return true
      }
      return false
    }
    if (key === 'Backspace') {
      if (inputBuffer.value === '') return false
      inputBuffer.value = inputBuffer.value.slice(0, -1)
      return true
    }
    if (BUFFER_CHAR_PATTERN.test(key) && vertices.value.length > 0) {
      if (key === ' ' && inputBuffer.value === '') return false
      inputBuffer.value += key
      return true
    }
    return false
  }

  function reset(): void {
    vertices.value = []
    inputBuffer.value = ''
    startAttachment = null
    lastAttachment = null
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
    thicknessIn,
    reference,
    inputBuffer,
    isDrawing,
    preview,
    setCursor,
    setAlt,
    setThickness,
    setReference,
    cycleReference,
    onClick,
    onDoubleClick,
    handleKey,
    cancel,
    deactivate,
    arm,
  }
}

function toJunction(end: 'start' | 'end', attachment: WallSnapAttachment): WallEndAttachment {
  return {
    end,
    host_wall_id: attachment.wallId,
    segment_index: attachment.segmentIndex,
    t: attachment.tIn,
  }
}
