import type { Dimension, Label, Point } from '@/types/plan'

import { projectPointOnSegment } from './lines'
import { boundsOfPoints, type Bounds } from './polygons'
import { add, angleOf, distance, dot, lerp, normalize, perpendicular, scale, sub } from './vec'

/**
 * Derived geometry for annotations (specs S7/S8): label text metrics and the
 * classic dimension figure (extension lines, dimension line, ticks, text).
 * Everything is recomputed from the stored anchors — never persisted.
 */

/** `size_in` is the cap height; SVG font-size is the em size (cap ≈ 0.7 em). */
const CAP_HEIGHT_RATIO = 0.7
/** Average glyph advance as a fraction of the em size, for bbox approximation. */
const AVG_CHAR_WIDTH_RATIO = 0.55
/** Descender depth below the baseline as a fraction of the em size. */
const DESCENDER_RATIO = 0.25

/** Gap between the measured point and the start of its extension line. */
const EXTENSION_GAP_IN = 1.5
/** How far the extension lines overshoot past the dimension line. */
const EXTENSION_OVERSHOOT_IN = 2
/** Half-length of the 45° tick strokes at each end of the dimension line. */
const TICK_HALF_IN = 2
/** Distance from the dimension line to the text baseline. */
const TEXT_OFFSET_IN = 2.5

const RAD_TO_DEG = 180 / Math.PI

/** Everything needed to render one dimension annotation (spec S8). */
export interface DimensionLayout {
  /** The dimension line, offset from `p1 -> p2` by `offset_in`. */
  line: { a: Point; b: Point }
  /** Extension lines from each measured point toward the dimension line. */
  extensions: { a: Point; b: Point }[]
  /** 45° tick strokes at each end of the dimension line. */
  ticks: { a: Point; b: Point }[]
  /** Text anchor (centre of the label, offset from the line). */
  textAnchor: Point
  /** Text rotation in degrees, normalized so the label is never upside down. */
  textAngleDeg: number
  /** Live measured distance `p1 -> p2` in inches. */
  distanceIn: number
}

/** SVG font-size (em, world inches) rendering `sizeIn` as the cap height (spec S7). */
export function labelFontSizeIn(sizeIn: number): number {
  return sizeIn / CAP_HEIGHT_RATIO
}

/**
 * Approximate world-space bounding box of a label's rendered text, anchored at
 * `position` (start of the baseline). Used for hit testing and band selection.
 */
export function labelBounds(label: Label): Bounds {
  const em = labelFontSizeIn(label.size_in)
  const width = Math.max(label.text.length, 1) * em * AVG_CHAR_WIDTH_RATIO
  return {
    minX: label.position.x,
    minY: label.position.y - label.size_in,
    maxX: label.position.x + width,
    maxY: label.position.y + em * DESCENDER_RATIO,
  }
}

/**
 * Lays out the classic dimension figure for `dimension` (spec S8): extension
 * lines from `p1`/`p2` perpendicular toward the offset side, the dimension
 * line at `offset_in` with 45° ticks, and the centred text anchor. Returns
 * `null` when the two anchors coincide.
 */
export function dimensionLayout(dimension: Dimension): DimensionLayout | null {
  const { p1, p2, offset_in: offset } = dimension
  const distanceIn = distance(p1, p2)
  if (distanceIn <= 0) return null
  const u = normalize(sub(p2, p1))
  const n = perpendicular(u)
  const a = add(p1, scale(n, offset))
  const b = add(p2, scale(n, offset))
  const side = offset >= 0 ? 1 : -1
  const extensionDir = scale(n, side)
  const extensions = [p1, p2].map((p) => ({
    a: add(p, scale(extensionDir, EXTENSION_GAP_IN)),
    b: add(p, scale(n, offset + side * EXTENSION_OVERSHOOT_IN)),
  }))
  const tickDir = normalize(add(u, n))
  const ticks = [a, b].map((end) => ({
    a: add(end, scale(tickDir, -TICK_HALF_IN)),
    b: add(end, scale(tickDir, TICK_HALF_IN)),
  }))
  const angleDeg = angleOf(u) * RAD_TO_DEG
  const upright = angleDeg > 90 ? angleDeg - 180 : angleDeg <= -90 ? angleDeg + 180 : angleDeg
  return {
    line: { a, b },
    extensions,
    ticks,
    textAnchor: add(lerp(a, b, 0.5), scale(extensionDir, TEXT_OFFSET_IN)),
    textAngleDeg: upright,
    distanceIn,
  }
}

/**
 * Signed offset (inches) a dimension must take for its line to pass through
 * `world` — the perpendicular-drag math of the select tool (spec S8).
 */
export function dimensionOffsetFor(dimension: Dimension, world: Point): number {
  const u = normalize(sub(dimension.p2, dimension.p1))
  return dot(sub(world, dimension.p1), perpendicular(u))
}

/** True when `world` is within `toleranceIn` of the dimension line or its text. */
export function dimensionHitTest(dimension: Dimension, world: Point, toleranceIn: number): boolean {
  const layout = dimensionLayout(dimension)
  if (!layout) return false
  if (projectPointOnSegment(world, layout.line.a, layout.line.b).distance <= toleranceIn) {
    return true
  }
  const textBounds = boundsOfPoints([layout.textAnchor])
  if (!textBounds) return false
  return (
    world.x >= textBounds.minX - 3 * toleranceIn &&
    world.x <= textBounds.maxX + 3 * toleranceIn &&
    world.y >= textBounds.minY - 2 * toleranceIn &&
    world.y <= textBounds.maxY + 2 * toleranceIn
  )
}
