import { DEVICE_STROKE_IN } from '@/export/exportTheme'
import type { PictogramShape } from '@/devices/pictograms'

/**
 * Low-level SVG serialisation shared by every export builder (spec X2/X5):
 * coordinate rounding, XML escaping and the pictogram-shape renderer. Kept in
 * its own module so the plan builder and the legend builder emit byte-identical
 * markup for the same input without either importing the other.
 */

const COORD_DECIMALS = 4

/** Rounds a world coordinate to the export's fixed precision. */
export function num(value: number): number {
  return Number(value.toFixed(COORD_DECIMALS))
}

/** Escapes the five XML entities so any user text is safe in an attribute or node. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Renders one pictogram shape, in the symbol's 12x12 coordinate box. */
export function renderPictogramShape(shape: PictogramShape, color: string): string {
  const stroke = `stroke="${color}" stroke-width="${DEVICE_STROKE_IN}" stroke-linecap="round" stroke-linejoin="round"`
  switch (shape.kind) {
    case 'circle':
      return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${shape.fill ? color : 'none'}" ${stroke} />`
    case 'line':
      return `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" ${stroke} />`
    case 'polyline': {
      const pts = shape.closed ? [...shape.points, shape.points[0]] : shape.points
      return `<polyline points="${pts.map(([x, y]) => `${x},${y}`).join(' ')}" fill="none" ${stroke} />`
    }
    case 'path':
      return `<path d="${shape.d}" fill="none" ${stroke} />`
    case 'rect':
      return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" fill="${shape.fill ? color : 'none'}" ${stroke} />`
    case 'text':
      return `<text x="${shape.x}" y="${shape.y}" font-size="${shape.size}" fill="${color}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif">${escapeXml(shape.text)}</text>`
  }
}
