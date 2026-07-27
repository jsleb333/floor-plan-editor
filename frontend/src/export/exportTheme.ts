/**
 * Literal colours and stroke widths for print-ready SVG/PNG export (spec X2/X3).
 *
 * The on-canvas editor styles its layers with Tailwind theme tokens defined in
 * `style.css` (`@theme`); a rendered SVG file has no stylesheet and no zoom, so
 * export resolves those same tokens to fixed hex constants here — one source
 * the export path shares — and uses fixed world-inch stroke widths (the editor
 * scales strokes to ~1px per screen pixel; a file is viewed at real scale).
 *
 * Keep these values in sync with the `@theme` block in `src/style.css`. Wall
 * colours are NOT here: they belong to the document (spec S1f) and resolve
 * through `utils/wallColors`, the same rule the canvas uses.
 */

/** Editor `--color-canvas`: the drawing background. */
export const EXPORT_CANVAS = '#f8f8f7'
/** Editor `--color-surface`: opaque white, the thumbnail/print background. */
export const EXPORT_SURFACE = '#ffffff'
/** Editor `--color-ink`: primary text and device pictograms. */
export const EXPORT_INK = '#1e293b'
/** Editor `--color-ink-muted`: stairs and dimension lines. */
export const EXPORT_INK_MUTED = '#64748b'
/** Panel fill behind the exported legend (spec X5). */
export const EXPORT_LEGEND_FILL = '#ffffff'
/** Editor `--color-line`: legend panel border and rules (spec X5). */
export const EXPORT_LINE = '#e2e8f0'

/** Wall outline / opening symbol stroke in world inches. */
export const STRUCTURE_STROKE_IN = 0.75
/** Dimension and stair line stroke in world inches. */
export const ANNOTATION_STROKE_IN = 0.75
/** Device pictogram stroke in world inches (12" nominal box). */
export const DEVICE_STROKE_IN = 0.7
/** Wire stroke in world inches. */
export const WIRE_STROKE_IN = 1.5
/** Text halo (paint-order stroke) width in world inches for legibility over lines. */
export const TEXT_HALO_STROKE_IN = 2
/** Font size in world inches for dimension figures and the stair direction label. */
export const ANNOTATION_TEXT_IN = 9
/** Blank margin in world inches added around the content bounds (spec X2). */
export const EXPORT_MARGIN_IN = 12
