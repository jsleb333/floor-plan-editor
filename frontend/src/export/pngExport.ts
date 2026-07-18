import type { PlanDocument } from '@/types/plan'

import { EXPORT_SURFACE } from './exportTheme'
import { buildPlanSvg, planViewBox } from './svgExport'
import type { SvgExportOptions } from './svgExport'

/**
 * Raster PNG export of a plan (spec X3, §10.1): serialise the shared SVG,
 * paint it onto an offscreen canvas at a chosen scale, and read back a PNG
 * blob. No dependency — the SVG string is the single geometry source, so the
 * PNG matches the SVG (and the canvas) exactly. The pixel-size math is a pure
 * function guarded by a total-pixel cap so a huge scale fails loudly instead
 * of exhausting memory.
 */

/** Presets for on-screen pixels per real foot (spec X3). */
export const PIXELS_PER_FOOT_PRESETS: readonly number[] = [12, 24, 48]

/** Maximum total canvas pixels (~16 MP) before an export is refused. */
export const MAX_TOTAL_PIXELS = 16_000_000

const INCHES_PER_FOOT = 12

/** Options for `renderPlanPng`, extending the SVG options with raster controls. */
export interface PngExportOptions extends SvgExportOptions {
  /** Raster density in pixels per real foot (spec X3). */
  pixelsPerFoot: number
  /** Omit the background fill for a transparent PNG (spec X3). */
  transparentBackground?: boolean
}

/** The integer canvas dimensions in pixels for a given content size and density. */
export interface PngPixelSize {
  width: number
  height: number
}

/**
 * Pixel dimensions of a PNG at `pixelsPerFoot`, for a content area of
 * `widthIn` x `heightIn` real inches. Throws when the total exceeds
 * `MAX_TOTAL_PIXELS` (spec X3 cap) or when inputs are non-positive.
 */
export function pngPixelSize(
  widthIn: number,
  heightIn: number,
  pixelsPerFoot: number,
): PngPixelSize {
  if (!(widthIn > 0) || !(heightIn > 0) || !(pixelsPerFoot > 0)) {
    throw new Error('PNG export size must be positive')
  }
  const pixelsPerInch = pixelsPerFoot / INCHES_PER_FOOT
  const width = Math.max(1, Math.round(widthIn * pixelsPerInch))
  const height = Math.max(1, Math.round(heightIn * pixelsPerInch))
  const total = width * height
  if (total > MAX_TOTAL_PIXELS) {
    const megapixels = (total / 1_000_000).toFixed(1)
    const cap = (MAX_TOTAL_PIXELS / 1_000_000).toFixed(0)
    throw new Error(
      `Image too large: ${width}×${height}px (${megapixels} MP) exceeds the ${cap} MP limit. Lower the scale.`,
    )
  }
  return { width, height }
}

/**
 * Renders a plan document to a PNG blob (spec X3). Computes the raster size
 * from the shared viewBox (guarded by the pixel cap), draws the SVG onto an
 * offscreen canvas, and resolves to the encoded blob.
 *
 * @param document The plan document to render.
 * @param options Raster density, transparency and the shared SVG options.
 */
export async function renderPlanPng(
  document: PlanDocument,
  options: PngExportOptions,
): Promise<Blob> {
  const transparent = options.transparentBackground ?? false
  const svgOptions: SvgExportOptions = {
    ...options,
    background: transparent ? null : EXPORT_SURFACE,
  }
  const viewBox = planViewBox(document, svgOptions)
  const size = pngPixelSize(viewBox.width, viewBox.height, options.pixelsPerFoot)
  const svg = buildPlanSvg(document, svgOptions)

  const image = await loadSvgImage(svg)
  const canvas = createCanvas(size.width, size.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  if (!transparent) {
    context.fillStyle = EXPORT_SURFACE
    context.fillRect(0, 0, size.width, size.height)
  }
  context.drawImage(image, 0, 0, size.width, size.height)
  return canvasToPngBlob(canvas)
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = window.document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to rasterise the plan SVG'))
    }
    image.src = url
  })
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to encode PNG'))
    }, 'image/png')
  })
}
