import type { Point } from '@/types/plan'
import type { DoorStroke } from '@/utils/geometry'

const COORD_DECIMALS = 4

function coord(value: number): number {
  return Number(value.toFixed(COORD_DECIMALS))
}

/**
 * Serializes closed polygon rings (no repeated last point) into a single SVG
 * path string, one `M … Z` subpath per ring. Rendered with
 * `fill-rule="evenodd"` this fills a closed wall loop's two rings as a band.
 * Rings with fewer than 3 points are skipped; returns '' when nothing remains.
 */
export function ringsToPath(rings: readonly (readonly Point[])[]): string {
  return rings
    .filter((ring) => ring.length >= 3)
    .map((ring) => `M ${ring.map((p) => `${coord(p.x)} ${coord(p.y)}`).join(' L ')} Z`)
    .join(' ')
}

/**
 * Serializes one polyline into an SVG path string: `M … L …`, with a trailing
 * `Z` when `closed` (the last point is NOT repeated). Returns '' for fewer
 * than 2 points (3 when closed).
 */
export function polylineToPath(points: readonly Point[], closed = false): string {
  if (points.length < (closed ? 3 : 2)) return ''
  const d = `M ${points.map((p) => `${coord(p.x)} ${coord(p.y)}`).join(' L ')}`
  return closed ? `${d} Z` : d
}

/**
 * Serializes one door stroke (spec S4): its polyline, then the swing arc when it
 * has one. The single serializer both the canvas layer and the SVG export use,
 * so a door of any style draws identically in each (spec §4.1).
 *
 * @param stroke The stroke to draw.
 * @param format Coordinate formatter — identity on the canvas (which needs no
 *     rounding), the export's fixed-decimal rounding in a file.
 */
export function doorStrokeToPath(
  stroke: DoorStroke,
  format: (value: number) => number = (value) => value,
): string {
  if (stroke.points.length < 2) return ''
  const d = `M ${stroke.points.map((p) => `${format(p.x)} ${format(p.y)}`).join(' L ')}`
  if (!stroke.arc) return d
  const { to, radiusIn, sweep } = stroke.arc
  return `${d} A ${format(radiusIn)} ${format(radiusIn)} 0 0 ${sweep} ${format(to.x)} ${format(to.y)}`
}
