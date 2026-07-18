import type { Point } from '@/types/plan'

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
