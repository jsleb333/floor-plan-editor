import type { Point, UnderlayTransform } from '@/types/plan'
import { add, scale as scaleVec, sub } from '@/utils/geometry'
import type { ImageSize } from '@/utils/imageSize'

/**
 * Pure transform math for the tracing underlay (spec §5.2).
 *
 * An underlay pixel `q` maps to world inches via
 * `world = origin + R(rotation_deg) · (q · scale)` — exactly the SVG transform
 * `translate(origin) rotate(rotation_deg) scale(scale)` applied to the image.
 */

const DEG_TO_RAD = Math.PI / 180

/** World width (~40') a freshly imported underlay spans — a sane trace-ready default (U1). */
export const DEFAULT_UNDERLAY_SPAN_IN = 480
/** Default underlay opacity (spec U3: ~40%). */
export const DEFAULT_UNDERLAY_OPACITY = 0.4

/** `v` rotated by `deg` degrees (clockwise on screen in y-down space, like SVG `rotate`). */
function rotate(v: Point, deg: number): Point {
  const rad = deg * DEG_TO_RAD
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos }
}

/** World position of the image pixel `pixel` under `transform`. */
export function underlayToWorld(transform: UnderlayTransform, pixel: Point): Point {
  return add(transform.origin, rotate(scaleVec(pixel, transform.scale), transform.rotation_deg))
}

/** Image pixel under the world point `world` (inverse of `underlayToWorld`). */
export function worldToUnderlayPixel(transform: UnderlayTransform, world: Point): Point {
  const local = rotate(sub(world, transform.origin), -transform.rotation_deg)
  return scaleVec(local, 1 / transform.scale)
}

/** Whether the world point lies on the image rectangle (hit testing). */
export function underlayContains(
  transform: UnderlayTransform,
  size: ImageSize,
  world: Point,
): boolean {
  const pixel = worldToUnderlayPixel(transform, world)
  return pixel.x >= 0 && pixel.x <= size.width && pixel.y >= 0 && pixel.y <= size.height
}

/**
 * New calibration scale (inches per pixel) from a reference segment (U2).
 *
 * The segment measured `segmentWorldLengthIn` under the CURRENT transform
 * covers `segmentWorldLengthIn / currentScale` image pixels; those pixels must
 * represent `knownLengthIn` real inches.
 */
export function calibrationScale(
  segmentWorldLengthIn: number,
  currentScale: number,
  knownLengthIn: number,
): number {
  return (knownLengthIn * currentScale) / segmentWorldLengthIn
}

/**
 * Rescales the underlay about a world anchor point: the image point currently
 * under `anchorWorld` stays exactly there, so recalibration never makes traced
 * geometry jump (U2).
 */
export function scaledAboutAnchor(
  transform: UnderlayTransform,
  anchorWorld: Point,
  newScale: number,
): UnderlayTransform {
  const factor = newScale / transform.scale
  return {
    origin: add(anchorWorld, scaleVec(sub(transform.origin, anchorWorld), factor)),
    rotation_deg: transform.rotation_deg,
    scale: newScale,
  }
}

/** Sets the rotation while keeping the image CENTRE fixed in world space (U3). */
export function rotatedAboutCenter(
  transform: UnderlayTransform,
  size: ImageSize,
  newRotationDeg: number,
): UnderlayTransform {
  const centrePixel = { x: size.width / 2, y: size.height / 2 }
  const centreWorld = underlayToWorld(transform, centrePixel)
  return {
    origin: sub(centreWorld, rotate(scaleVec(centrePixel, transform.scale), newRotationDeg)),
    rotation_deg: newRotationDeg,
    scale: transform.scale,
  }
}

/** Identity transform for a fresh import: image centred on `centre`, ~40' wide (U1). */
export function initialUnderlayTransform(size: ImageSize, centre: Point): UnderlayTransform {
  const scale = DEFAULT_UNDERLAY_SPAN_IN / size.width
  return {
    origin: {
      x: centre.x - (size.width * scale) / 2,
      y: centre.y - (size.height * scale) / 2,
    },
    rotation_deg: 0,
    scale,
  }
}
