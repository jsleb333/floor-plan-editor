import type { Point } from '@/types/plan'

import { ALIGNMENT_LINE_DIRECTIONS } from './angles'
import { lineIntersection } from './lines'
import type { NetworkAnchor, NetworkAnchorKind } from './network'
import { EPSILON, add, cross, distance, length, perpendicular, scale, sub } from './vec'

/**
 * Ranking of anchor kinds (spec S1e): the surface corners a user can SEE outrank
 * the spine ends they cannot, which outrank a T's centre. Aligning to what is on
 * screen is the whole point of a guide.
 */
const KIND_RANK: Record<AlignmentAnchorKind, number> = {
  'face-corner': 0,
  'spine-end': 1,
  joint: 2,
}

/** How an S1e anchor relates to the wall network (`docs/WALL_NETWORK.md` §8). */
export type AlignmentAnchorKind = NetworkAnchorKind

/** A point that alignment guides may be projected through (spec S1e). */
export type AlignmentAnchor = NetworkAnchor

/** One engaged alignment guide: the 0/45/90/135° line through `anchor` the point snapped onto. */
export interface AlignmentGuide {
  anchor: Point
  kind: AlignmentAnchorKind
  /** Unit direction of the guide line (one of the four alignment-line directions). */
  dir: Point
}

/** An S1e alignment solution: the snapped point plus the guide(s) to render (at most two). */
export interface AnchorAlignment {
  point: Point
  guides: AlignmentGuide[]
}

interface GuideCandidate {
  anchor: AlignmentAnchor
  dir: Point
  /** How far the pending point must move to land on the guide line, in inches. */
  shiftIn: number
  /** Distance from the pending point to the anchor, in inches ("nearest anchors win"). */
  anchorDistIn: number
}

/**
 * The network anchors within `captureIn` of the cursor (spec S1e).
 *
 * The set comes from the resolved network, so a guide is guaranteed to pass
 * through a corner that is actually drawn — previously the anchors were spine
 * vertices, which on a 12" wall sit 6" from the visible corner, and users were
 * aligning to a point they could not see (`docs/WALL_NETWORK.md` §8).
 */
export function collectAlignmentAnchors(
  anchors: readonly NetworkAnchor[],
  cursor: Point,
  captureIn: number,
): AlignmentAnchor[] {
  return anchors.filter((anchor) => distance(cursor, anchor.point) <= captureIn)
}

/**
 * Snaps a free (unconstrained) pending point onto the alignment lines through
 * nearby anchors (spec S1e).
 *
 * Every alignment line through an anchor passing within `toleranceIn` of the
 * cursor is a candidate; collinear candidates collapse onto their best anchor
 * (most visible kind first, then the nearest — "nearest anchors win"). When two
 * candidates from distinct anchors cross within `toleranceIn` of the cursor,
 * the point snaps to the crossing and both guides are returned (intersections
 * outrank single lines). Otherwise the cursor projects onto the single best
 * candidate: the most visible anchor kind wins, then the line needing
 * the smallest move wins. Returns `null` when no line is in reach.
 */
export function anchorAlignFree(
  cursor: Point,
  anchors: readonly AlignmentAnchor[],
  toleranceIn: number,
): AnchorAlignment | null {
  const candidates = collectCandidates(cursor, anchors, toleranceIn)
  if (candidates.length === 0) return null

  const crossing = bestCrossing(cursor, candidates, toleranceIn)
  if (crossing) return crossing

  let best = candidates[0]
  for (let i = 1; i < candidates.length; i++) {
    if (compareCandidates(candidates[i], best) < 0) best = candidates[i]
  }
  // Drop the cursor perpendicularly onto the line (rather than walking out
  // from the anchor): exact when the cursor is already on it, so points that
  // land clean (e.g. grid-snapped clicks) stay clean.
  const signedShiftIn = cross(sub(cursor, best.anchor.point), best.dir)
  return {
    point: sub(cursor, scale(perpendicular(best.dir), signedShiftIn)),
    guides: [toGuide(best)],
  }
}

/**
 * Slides an angle-constrained pending point along its ray onto the alignment
 * lines through nearby anchors (spec S1e composed with the S1 angle lock).
 *
 * Mirrors `alignOnRay` (S1c) over the whole anchor set: each anchor line is
 * intersected with the ray `rayOrigin + t * rayDir`, and crossings strictly
 * ahead of the origin whose slide from `alongIn` stays within `toleranceIn`
 * compete — the most visible anchor kind wins, then the smallest
 * slide wins, then the nearest anchor. Intersection snapping does not apply
 * here: the ray already pins the point to one line, so a crossing IS the
 * intersection with it. Returns `null` when no line is in reach.
 */
export function anchorAlignOnRay(
  rayOrigin: Point,
  rayDir: Point,
  anchors: readonly AlignmentAnchor[],
  alongIn: number,
  toleranceIn: number,
): AnchorAlignment | null {
  const pending = add(rayOrigin, scale(rayDir, alongIn))
  let best: GuideCandidate | null = null
  let bestT = 0
  for (const anchor of anchors) {
    const anchorDistIn = distance(pending, anchor.point)
    for (const dir of ALIGNMENT_LINE_DIRECTIONS) {
      const den = cross(rayDir, dir)
      if (Math.abs(den) <= EPSILON) continue
      const t = cross(sub(anchor.point, rayOrigin), dir) / den
      if (t <= EPSILON) continue
      const shiftIn = Math.abs(t - alongIn)
      if (shiftIn > toleranceIn) continue
      const candidate: GuideCandidate = { anchor, dir, shiftIn, anchorDistIn }
      if (!best || compareCandidates(candidate, best) < 0) {
        best = candidate
        bestT = t
      }
    }
  }
  if (!best) return null
  return { point: add(rayOrigin, scale(rayDir, bestT)), guides: [toGuide(best)] }
}

function collectCandidates(
  cursor: Point,
  anchors: readonly AlignmentAnchor[],
  toleranceIn: number,
): GuideCandidate[] {
  const candidates: GuideCandidate[] = []
  for (const anchor of anchors) {
    const offset = sub(cursor, anchor.point)
    const anchorDistIn = length(offset)
    for (const dir of ALIGNMENT_LINE_DIRECTIONS) {
      const shiftIn = Math.abs(cross(offset, dir))
      if (shiftIn > toleranceIn) continue
      const candidate: GuideCandidate = { anchor, dir, shiftIn, anchorDistIn }
      const collinear = candidates.findIndex((other) => sameLine(other, candidate))
      if (collinear === -1) {
        candidates.push(candidate)
      } else if (compareCandidates(candidate, candidates[collinear]) < 0) {
        candidates[collinear] = candidate
      }
    }
  }
  return candidates
}

/**
 * Best crossing of two candidate lines from distinct anchors near the cursor,
 * preferring endpoint-anchored pairs, then the crossing nearest the cursor.
 */
function bestCrossing(
  cursor: Point,
  candidates: readonly GuideCandidate[],
  toleranceIn: number,
): AnchorAlignment | null {
  let best: { point: Point; a: GuideCandidate; b: GuideCandidate } | null = null
  let bestRank = Infinity
  let bestDistIn = Infinity
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]
      const b = candidates[j]
      if (distance(a.anchor.point, b.anchor.point) <= EPSILON) continue
      const point = lineIntersection(a.anchor.point, a.dir, b.anchor.point, b.dir)
      if (!point) continue
      const distIn = distance(cursor, point)
      if (distIn > toleranceIn) continue
      const rank = KIND_RANK[a.anchor.kind] + KIND_RANK[b.anchor.kind]
      if (rank < bestRank || (rank === bestRank && distIn < bestDistIn)) {
        best = { point, a, b }
        bestRank = rank
        bestDistIn = distIn
      }
    }
  }
  if (!best) return null
  return { point: best.point, guides: [toGuide(best.a), toGuide(best.b)] }
}

/** Candidate order: most visible kind, then smallest move, then nearest anchor. */
function compareCandidates(a: GuideCandidate, b: GuideCandidate): number {
  return (
    KIND_RANK[a.anchor.kind] - KIND_RANK[b.anchor.kind] ||
    a.shiftIn - b.shiftIn ||
    a.anchorDistIn - b.anchorDistIn
  )
}

/** Whether two candidates describe the same infinite line (collinear anchors). */
function sameLine(a: GuideCandidate, b: GuideCandidate): boolean {
  if (a.dir !== b.dir) return false
  return Math.abs(cross(sub(b.anchor.point, a.anchor.point), a.dir)) <= EPSILON
}

function toGuide(candidate: GuideCandidate): AlignmentGuide {
  return {
    anchor: { ...candidate.anchor.point },
    kind: candidate.anchor.kind,
    dir: candidate.dir,
  }
}
