import { computed, shallowRef, ref } from 'vue'
import type { ComputedRef, Ref, ShallowRef } from 'vue'

import type { Joint, Point, TeeJoint, Wall, WallEnd } from '@/types/plan'
import {
  EPSILON,
  add,
  alignedClose,
  autoSquareClose,
  distance,
  flushSpinePoint,
  scale,
  sub,
  surfaceAnchor,
  wallFacePolylines,
  wallOutline,
} from '@/utils/geometry'
import type {
  AlignmentGuide,
  FlushPlacement,
  ResolvedNetwork,
  SurfaceAnchor,
  WallFacePolylines,
  WallReference,
} from '@/utils/geometry'
import { formatFeetInches, parseFeetInches } from '@/utils/units'

import type {
  SnapChainContext,
  SnapGuide,
  SnapMarkerKind,
  SnapResult,
  SnapTarget,
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
  /**
   * Effective reference polyline of the pending chain — vertices plus the
   * snapped cursor, or the close-adjusted loop while the close affordance is
   * engaged (spec S1c) — so the overlay draws exactly what a commit creates.
   */
  chain: Point[]
  /** Face polylines of the pending chain, for the S1a left/right face tints. */
  faces: WallFacePolylines | null
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
  commit: (wall: Wall, joints: Joint[]) => void
  /**
   * The resolved network, for continuing an existing wall's surface flush
   * (`docs/WALL_NETWORK.md` §6). Without it a surface-terminus snap still lands
   * on the corner, it simply is not offset into a shared surface.
   */
  network?: Ref<ResolvedNetwork>
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
  const { snapping, commit, onAutoPreset, network } = options
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
  /** What the first and most recent clicks captured, for the relations to record. */
  let startTarget: SnapTarget | null = null
  let lastTarget: SnapTarget | null = null
  // Whether the user explicitly picked a thickness since the last arm; an
  // explicit pick always wins and suppresses the smart presets (spec S1d).
  let manualOverride = false

  const isDrawing = computed(() => vertices.value.length > 0)

  function chainContext(): SnapChainContext | null {
    // The ALIGNED chain, so closing a loop targets where the first vertex really
    // is: a flush start sits offset from the corner the user clicked, and
    // closing onto the raw corner would leave a misclosure of that offset.
    const chain = vertices.value.length >= 2 ? alignedChain(vertices.value, null) : vertices.value
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

    let previewChain = alignedChain(chain, point)
    if (snap?.marker === 'close') {
      previewChain = [...closingChain(chain), chain[0]]
    }
    const geometry =
      previewChain.length >= 2
        ? {
            vertices: previewChain,
            thicknessIn: thicknessIn.value,
            reference: reference.value,
          }
        : null
    const rings = geometry ? wallOutline(geometry) : []
    const faces = geometry ? wallFacePolylines(geometry) : null

    return {
      vertices: chain,
      point,
      segment,
      rings,
      chain: previewChain,
      faces,
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

  function pushVertex(
    point: Point,
    attachment: WallSnapAttachment | null,
    target: SnapTarget | null = null,
  ): void {
    const chain = vertices.value
    const last = chain[chain.length - 1]
    if (last && distance(last, point) <= EPSILON) return
    if (chain.length === 0) {
      startAttachment = attachment
      startTarget = target
    }
    lastAttachment = attachment
    lastTarget = target
    vertices.value = [...chain, { ...point }]
  }

  function onClick(world: Point): void {
    const snap = snapping.resolve(world, chainContext(), altHeld.value)
    if (snap.marker === 'close') {
      closeChain()
      return
    }
    pushVertex(snap.point, snap.attachment, snap.target)
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
      lastTarget = null
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

  /** The anchor of a captured surface terminus, when the target is one. */
  function anchorFor(target: SnapTarget | null): SurfaceAnchor | null {
    if (target?.kind !== 'surface-end') return null
    const resolved = network?.value.walls.get(target.wallId)
    return resolved ? surfaceAnchor(resolved, target.side, target.end) : null
  }

  /**
   * The chain with any surface continuation applied: an end captured on a
   * wall's surface terminus is offset perpendicular to that surface so the new
   * wall's OWN surface continues it (`docs/WALL_NETWORK.md` §6).
   *
   * Derived rather than written back into `vertices`, so the offset re-solves
   * whenever the direction, thickness or reference side changes, and the record
   * of where the user actually clicked stays intact.
   */
  function alignedChain(chain: readonly Point[], pending: Point | null): Point[] {
    const points = pending ? [...chain, pending] : [...chain]
    if (points.length < 2) return points
    const start = flushAt(startTarget, points[0], points[1])
    if (start) points[0] = start.point
    const end = flushAt(lastTarget, points[points.length - 1], points[points.length - 2])
    if (end) points[points.length - 1] = end.point
    return points
  }

  /** The flush placement for one captured end, given the neighbour it runs toward. */
  function flushAt(
    target: SnapTarget | null,
    captured: Point,
    neighbour: Point,
  ): FlushPlacement | null {
    const anchor = anchorFor(target)
    if (!anchor) return null
    return flushSpinePoint(anchor, sub(neighbour, captured), thicknessIn.value, reference.value)
  }

  function commitWall(wallVertices: Point[], closed: boolean): void {
    const id = crypto.randomUUID()
    const aligned = alignedChain(wallVertices, null)
    const joints: Joint[] = []
    const startJoint = jointFor(
      id,
      'start',
      startTarget,
      startAttachment,
      wallVertices.length >= 2 ? flushAt(startTarget, wallVertices[0], wallVertices[1]) : null,
    )
    if (startJoint) joints.push(startJoint)
    if (!closed) {
      const last = wallVertices.length - 1
      const endJoint = jointFor(
        id,
        'end',
        lastTarget,
        lastAttachment,
        wallVertices.length >= 2
          ? flushAt(lastTarget, wallVertices[last], wallVertices[last - 1])
          : null,
      )
      if (endJoint) joints.push(endJoint)
    }
    commit(
      {
        id,
        vertices: aligned.map((vertex) => ({ ...vertex })),
        thickness_in: thicknessIn.value,
        reference: reference.value,
        closed,
        locked_segments: [],
      },
      joints,
    )
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
    startTarget = null
    lastTarget = null
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

/**
 * The relation to record for one end of a new wall (`docs/WALL_NETWORK.md` §6).
 *
 * A captured wall END makes a corner — the two spines meet, so their faces
 * mitre. A captured SURFACE makes a T, with the endpoint already sitting on the
 * surface rather than reaching to the host's spine. A captured surface TERMINUS
 * makes a shared surface, which is what lets a thinner wall continue a thicker
 * one as a single wall; that one needs `placement`, since which of the new
 * wall's surfaces is shared depends on the direction it runs. A spine
 * projection with no surface target is still a T, from the pre-network path.
 */
function jointFor(
  wallId: string,
  end: WallEnd,
  target: SnapTarget | null,
  attachment: WallSnapAttachment | null,
  placement: FlushPlacement | null,
): Joint | null {
  if (target?.kind === 'surface-end') {
    if (!placement) return null
    return {
      id: crypto.randomUUID(),
      kind: 'flush',
      a: { ref: { wall_id: target.wallId, end: target.end }, side: target.side },
      b: { ref: { wall_id: wallId, end }, side: placement.side },
    }
  }
  if (target?.kind === 'wall-end') {
    return {
      id: crypto.randomUUID(),
      kind: 'corner',
      ends: [
        { wall_id: target.wallId, end: target.end },
        { wall_id: wallId, end },
      ],
      rule: 'miter',
    }
  }
  if (target?.kind === 'surface') {
    return {
      id: crypto.randomUUID(),
      kind: 'tee',
      end: { wall_id: wallId, end },
      host: { wall_id: target.wallId, segment_index: target.segmentIndex },
    }
  }
  if (attachment) return teeJoint(wallId, end, attachment)
  return null
}

/**
 * The T relation for a projection snap (`docs/WALL_NETWORK.md` §3).
 *
 * Only the host SEGMENT is recorded, not how far along it: the position is the
 * endpoint's own coordinates, and storing it twice would be a second source of
 * truth that can disagree.
 */
function teeJoint(wallId: string, end: WallEnd, attachment: WallSnapAttachment): TeeJoint {
  return {
    id: crypto.randomUUID(),
    kind: 'tee',
    end: { wall_id: wallId, end },
    host: { wall_id: attachment.wallId, segment_index: attachment.segmentIndex },
  }
}
