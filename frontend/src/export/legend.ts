import { DEVICE_CATALOG, DEVICE_TYPES } from '@/devices/catalog'
import { DEVICE_PICTOGRAMS, PICTOGRAM_CENTER } from '@/devices/pictograms'
import type { Circuit, DeviceType, PlanDocument } from '@/types/plan'
import { wallColor, wallRoleOf } from '@/utils/wallColors'
import type { WallRole } from '@/utils/wallColors'

import {
  EXPORT_INK,
  EXPORT_INK_MUTED,
  EXPORT_LEGEND_FILL,
  EXPORT_LINE,
  STRUCTURE_STROKE_IN,
  WIRE_STROKE_IN,
} from './exportTheme'
import { EXPORT_STRINGS } from './exportLocale'
import type { ExportLanguage } from './exportLocale'
import { escapeXml, num, renderPictogramShape } from './svgPrimitives'

/**
 * The legend block of an exported plan (spec X5): what each colour and each
 * pictogram on the sheet means, in English or Québec French.
 *
 * The legend is DERIVED from the document — only circuits actually exported,
 * only device types actually placed, only wall colours actually drawn — so a
 * printed sheet can never advertise a symbol it does not carry. Everything is
 * measured and drawn in real world inches, like the rest of the export, which
 * lets `planViewBox` reserve the column before a single glyph is serialised
 * and lets PNG rasterise the legend at exactly the plan's own scale.
 */

/** A colour block: a wall poché sample. */
interface LegendSwatchEntry {
  kind: 'swatch'
  color: string
  label: string
}

/** A stroke sample: one circuit's wire colour. */
interface LegendLineEntry {
  kind: 'line'
  color: string
  label: string
}

/** A device pictogram drawn from the same registry the plan draws from. */
interface LegendPictogramEntry {
  kind: 'pictogram'
  type: DeviceType
  label: string
  count: number
}

export type LegendEntry = LegendSwatchEntry | LegendLineEntry | LegendPictogramEntry

/** One titled group of the legend; empty groups are never produced. */
export interface LegendSection {
  title: string
  entries: LegendEntry[]
}

/** What the legend needs to know about the export it is describing. */
export interface LegendOptions {
  language: ExportLanguage
  /** Circuits included in the export, or `'all'` — the legend lists only those. */
  circuitIds?: 'all' | readonly string[]
}

/** Panel padding on all four sides, in world inches. */
const PADDING_IN = 9
/** Font size of the legend title, in world inches. */
const TITLE_SIZE_IN = 12
/** Font size of a section heading, in world inches. */
const SECTION_SIZE_IN = 10
/** Font size of an entry label, in world inches. */
const ROW_SIZE_IN = 8
/** Vertical pitch of one entry row, in world inches. */
const ROW_HEIGHT_IN = 14
/** Gap under the title, above each section after the first, and under a heading. */
const TITLE_GAP_IN = 10
const SECTION_GAP_IN = 8
const HEADING_GAP_IN = 4
/** Width of the symbol column (also the pictogram box size), in world inches. */
const SYMBOL_IN = 12
/** Gap between the symbol column and its label, in world inches. */
const SYMBOL_GAP_IN = 6
/** Height of a wall colour block, in world inches. */
const SWATCH_HEIGHT_IN = 8
/** Width of the pictogram authoring box, whose shapes the legend rescales. */
const PICTOGRAM_BOX = 2 * PICTOGRAM_CENTER
/**
 * Advance width of one character as a fraction of the font size. Text cannot be
 * measured without a DOM, and the builder is pure, so the panel is sized from
 * this ratio — generous enough for the sans-serif digits and accents used here.
 */
const CHAR_WIDTH_RATIO = 0.55
/** Panel width bounds in world inches: never cramped, never a second plan. */
const MIN_WIDTH_IN = 132
const MAX_WIDTH_IN = 360
/** Corner radius of the legend panel, in world inches. */
const PANEL_RADIUS_IN = 3

/** The rating a circuit advertises: its breaker for power, its kind otherwise (spec C3). */
function circuitRating(circuit: Circuit, language: ExportLanguage): string {
  const strings = EXPORT_STRINGS[language]
  if (circuit.kind === 'data') return strings.dataCircuit
  if (circuit.kind === 'low_voltage') return strings.lowVoltageCircuit
  return `${circuit.breaker_a} A · ${circuit.voltage_v} V`
}

/** The device name in the export language: the catalog label, or its French legend name. */
function deviceName(type: DeviceType, language: ExportLanguage): string {
  const entry = DEVICE_CATALOG[type]
  return language === 'fr' ? entry.legendFr : entry.label
}

function circuitSection(document: PlanDocument, options: LegendOptions): LegendSection | null {
  const allowed =
    options.circuitIds === undefined || options.circuitIds === 'all'
      ? null
      : new Set(options.circuitIds)
  const entries = document.circuits
    .filter((circuit) => !allowed || allowed.has(circuit.id))
    .map<LegendEntry>((circuit) => ({
      kind: 'line',
      color: circuit.color,
      label: `${circuit.name} — ${circuitRating(circuit, options.language)}`,
    }))
  if (entries.length === 0) return null
  return { title: EXPORT_STRINGS[options.language].circuits, entries }
}

function deviceSection(document: PlanDocument, options: LegendOptions): LegendSection | null {
  const counts = new Map<DeviceType, number>()
  for (const device of document.devices) {
    counts.set(device.type, (counts.get(device.type) ?? 0) + 1)
  }
  // Catalog order, so two plans of the same house legend their devices alike.
  const entries = DEVICE_TYPES.filter((type) => counts.has(type)).map<LegendEntry>((type) => ({
    kind: 'pictogram',
    type,
    label: deviceName(type, options.language),
    count: counts.get(type) ?? 0,
  }))
  if (entries.length === 0) return null
  return { title: EXPORT_STRINGS[options.language].devices, entries }
}

function wallSection(document: PlanDocument, options: LegendOptions): LegendSection | null {
  const strings = EXPORT_STRINGS[options.language]
  const presetsIn = document.thickness_presets_in
  const roleLabels: Record<WallRole, string> = {
    exterior: strings.exteriorWall,
    interior: strings.interiorWall,
  }
  // One row per (colour, role) pair actually drawn, shell rows first — a custom
  // colour on a partition and the same colour on the shell mean different things.
  const seen = new Set<string>()
  const rows: { role: WallRole; entry: LegendEntry }[] = []
  for (const wall of document.walls) {
    const role = wallRoleOf(wall.thickness_in, presetsIn)
    const color = wallColor(wall, presetsIn)
    const key = `${role}:${color.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ role, entry: { kind: 'swatch', color, label: roleLabels[role] } })
  }
  if (rows.length === 0) return null
  const entries = [
    ...rows.filter((row) => row.role === 'exterior'),
    ...rows.filter((row) => row.role === 'interior'),
  ].map((row) => row.entry)
  return { title: strings.walls, entries }
}

/**
 * The legend of a plan: the circuits it exports, the device types it places and
 * the wall colours it draws, in that order. Sections with nothing to say are
 * left out, so an empty plan legends to no sections at all — and then
 * `legendSize` reserves nothing.
 */
export function planLegend(document: PlanDocument, options: LegendOptions): LegendSection[] {
  return [
    circuitSection(document, options),
    deviceSection(document, options),
    wallSection(document, options),
  ].filter((section): section is LegendSection => section !== null)
}

/** The world-inch footprint the legend panel occupies. */
export interface LegendSize {
  widthIn: number
  heightIn: number
}

function textWidthIn(text: string, fontSizeIn: number): number {
  return text.length * fontSizeIn * CHAR_WIDTH_RATIO
}

function entryLabel(entry: LegendEntry): string {
  return entry.kind === 'pictogram' ? `${entry.label}  × ${entry.count}` : entry.label
}

/**
 * Size of the panel `renderLegend` would draw for `sections`, or null when
 * there is nothing to legend. Pure and cheap, so the viewBox can reserve the
 * column before anything is serialised.
 */
export function legendSize(
  sections: readonly LegendSection[],
  language: ExportLanguage,
): LegendSize | null {
  if (sections.length === 0) return null
  let contentWidth = textWidthIn(EXPORT_STRINGS[language].legendTitle, TITLE_SIZE_IN)
  let height = PADDING_IN + TITLE_SIZE_IN + TITLE_GAP_IN
  sections.forEach((section, index) => {
    if (index > 0) height += SECTION_GAP_IN
    height += SECTION_SIZE_IN + HEADING_GAP_IN + section.entries.length * ROW_HEIGHT_IN
    contentWidth = Math.max(contentWidth, textWidthIn(section.title, SECTION_SIZE_IN))
    for (const entry of section.entries) {
      contentWidth = Math.max(
        contentWidth,
        SYMBOL_IN + SYMBOL_GAP_IN + textWidthIn(entryLabel(entry), ROW_SIZE_IN),
      )
    }
  })
  const widthIn = Math.min(MAX_WIDTH_IN, Math.max(MIN_WIDTH_IN, contentWidth + 2 * PADDING_IN))
  return { widthIn, heightIn: height + PADDING_IN }
}

function renderEntrySymbol(entry: LegendEntry, centerY: number): string {
  switch (entry.kind) {
    case 'swatch':
      return `<rect x="0" y="${num(centerY - SWATCH_HEIGHT_IN / 2)}" width="${SYMBOL_IN}" height="${SWATCH_HEIGHT_IN}" fill="${entry.color}" stroke="${entry.color}" stroke-width="${STRUCTURE_STROKE_IN}" />`
    case 'line':
      return `<line x1="0" y1="${num(centerY)}" x2="${SYMBOL_IN}" y2="${num(centerY)}" stroke="${entry.color}" stroke-width="${WIRE_STROKE_IN}" stroke-linecap="round" />`
    case 'pictogram': {
      // The same registry shapes the plan draws, rescaled from the 12-unit
      // authoring box into the symbol column and centred on the row.
      const scale = SYMBOL_IN / PICTOGRAM_BOX
      const shapes = DEVICE_PICTOGRAMS[entry.type]
        .map((shape) => renderPictogramShape(shape, EXPORT_INK))
        .join('')
      return `<g transform="translate(${num(SYMBOL_IN / 2)} ${num(centerY)}) scale(${num(scale)}) translate(${-PICTOGRAM_CENTER} ${-PICTOGRAM_CENTER})">${shapes}</g>`
    }
  }
}

/**
 * Serialises the legend panel as one `<g id="legend">` whose local origin is
 * its top-left corner, translated to (`x`, `y`) in world inches.
 */
export function renderLegend(
  sections: readonly LegendSection[],
  size: LegendSize,
  language: ExportLanguage,
  x: number,
  y: number,
): string {
  const parts: string[] = [
    `<rect x="0" y="0" width="${num(size.widthIn)}" height="${num(size.heightIn)}" rx="${PANEL_RADIUS_IN}" fill="${EXPORT_LEGEND_FILL}" stroke="${EXPORT_LINE}" stroke-width="${STRUCTURE_STROKE_IN}" />`,
  ]
  let cursor = PADDING_IN + TITLE_SIZE_IN
  parts.push(
    `<text x="${PADDING_IN}" y="${num(cursor)}" font-size="${TITLE_SIZE_IN}" font-weight="bold" fill="${EXPORT_INK}" font-family="sans-serif">${escapeXml(EXPORT_STRINGS[language].legendTitle)}</text>`,
  )
  cursor += TITLE_GAP_IN
  sections.forEach((section, index) => {
    if (index > 0) cursor += SECTION_GAP_IN
    cursor += SECTION_SIZE_IN
    parts.push(
      `<text x="${PADDING_IN}" y="${num(cursor)}" font-size="${SECTION_SIZE_IN}" font-weight="bold" fill="${EXPORT_INK_MUTED}" font-family="sans-serif">${escapeXml(section.title)}</text>`,
    )
    cursor += HEADING_GAP_IN
    for (const entry of section.entries) {
      const centerY = cursor + ROW_HEIGHT_IN / 2
      parts.push(
        `<g transform="translate(${PADDING_IN} 0)">${renderEntrySymbol(entry, centerY)}` +
          `<text x="${num(SYMBOL_IN + SYMBOL_GAP_IN)}" y="${num(centerY)}" font-size="${ROW_SIZE_IN}" dominant-baseline="central" fill="${EXPORT_INK}" font-family="sans-serif">${escapeXml(entryLabel(entry))}</text></g>`,
      )
      cursor += ROW_HEIGHT_IN
    }
  })
  return `<g id="legend" transform="translate(${num(x)} ${num(y)})">${parts.join('')}</g>`
}
