import type { Point, Wall, WallEnd, WallSide } from '@/types/plan'

import { normalize, scale, sub } from '../vec'
import { wallFacePolylines, wallSpine } from '../wallOutline'
import type { WallFacePolylines, WallGeometryInput, WallSpine } from '../wallOutline'

/** A wall's own derived geometry, before any joint is resolved. */
export interface WallGeometry {
  wall: Wall
  spine: WallSpine
  faces: WallFacePolylines
}

/**
 * The geometry of one wall end, as the joint resolvers need it.
 *
 * `leftCap`/`rightCap` are the face polylines' terminal points — the corners of
 * the square butt cap a free end gets today. Every resolution replaces those
 * two points and nothing else, which is what keeps the resolver incapable of
 * relocating a wall (`docs/WALL_NETWORK.md` §2).
 */
export interface EndFrame {
  wallId: string
  end: WallEnd
  /** Spine terminus. */
  spine: Point
  /** The adjacent spine vertex — tells the resolvers which way the body lies. */
  inner: Point
  /** Unit direction of the end segment in the wall's drawing direction. */
  travel: Point
  /** Unit direction pointing out of the body: `travel` at the end, reversed at the start. */
  outward: Point
  leftCap: Point
  rightCap: Point
}

/** Adapts the persisted wall shape to the geometry module's input. */
export function geometryInputOf(wall: Wall): WallGeometryInput {
  return {
    vertices: wall.vertices,
    thicknessIn: wall.thickness_in,
    reference: wall.reference,
    closed: wall.closed,
  }
}

/** Derives one wall's spine and face polylines. Throws `RangeError` on a non-positive thickness. */
export function wallGeometry(wall: Wall): WallGeometry {
  const input = geometryInputOf(wall)
  return { wall, spine: wallSpine(input), faces: wallFacePolylines(input) }
}

/**
 * The frame of one wall end, or `null` when the wall has no such free end — a
 * ring has none, and a chain of fewer than two distinct vertices has no
 * direction.
 */
export function endFrame(geometry: WallGeometry, end: WallEnd): EndFrame | null {
  const { points, closed } = geometry.spine
  const { left, right } = geometry.faces
  if (closed || points.length < 2 || left.length === 0 || right.length === 0) return null

  const terminal = end === 'start' ? 0 : points.length - 1
  const adjacent = end === 'start' ? 1 : points.length - 2
  const spine = points[terminal]
  const inner = points[adjacent]
  const travel = normalize(end === 'start' ? sub(inner, spine) : sub(spine, inner))
  if (travel.x === 0 && travel.y === 0) return null

  const faceIndex = end === 'start' ? 0 : -1
  return {
    wallId: geometry.wall.id,
    end,
    spine,
    inner,
    travel,
    outward: end === 'start' ? scale(travel, -1) : travel,
    leftCap: at(left, faceIndex),
    rightCap: at(right, faceIndex),
  }
}

/** The cap corner of `frame` on `side`. */
export function capOf(frame: EndFrame, side: WallSide): Point {
  return side === 'left' ? frame.leftCap : frame.rightCap
}

function at(points: readonly Point[], index: number): Point {
  return index < 0 ? points[points.length + index] : points[index]
}
