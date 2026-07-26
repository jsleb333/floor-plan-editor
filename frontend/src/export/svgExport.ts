import { assetUrl } from '@/api/assets'
import { DEVICE_PICTOGRAMS } from '@/devices/pictograms'
import type { PictogramShape } from '@/devices/pictograms'
import type {
  Circuit,
  Device,
  Dimension,
  Label,
  Opening,
  PlanDocument,
  Point,
  Stairs,
  Underlay,
  Wall,
  Wire,
} from '@/types/plan'
import {
  boundsOfPoints,
  deviceWorldPlacement,
  dimensionLayout,
  doorSymbol,
  labelBounds,
  labelFontSizeIn,
  openingWorldRect,
  stairsArrow,
  arrowHeadStrokes,
  stairsCenter,
  stairsCorners,
  stairsTreads,
  trimEndpointToHostFace,
  wallOutline,
  windowSymbol,
  wireEndpoint,
  wirePathData,
} from '@/utils/geometry'
import type { Bounds } from '@/utils/geometry'
import { ringsToPath } from '@/utils/svgPath'
import { formatFeetInches } from '@/utils/units'

import {
  ANNOTATION_STROKE_IN,
  ANNOTATION_TEXT_IN,
  DEVICE_STROKE_IN,
  EXPORT_CANVAS,
  EXPORT_INK,
  EXPORT_INK_MUTED,
  EXPORT_MARGIN_IN,
  EXPORT_WALL_EDGE,
  EXPORT_WALL_FILL,
  STRUCTURE_STROKE_IN,
  TEXT_HALO_STROKE_IN,
  WIRE_STROKE_IN,
} from './exportTheme'

/**
 * Standalone SVG export of a plan document (spec X2, §10.1).
 *
 * `buildPlanSvg` is a PURE function: it serialises exactly the geometry the
 * editor renders, reusing the shared geometry helpers (`wallOutline`,
 * `openingWorldRect`, `doorSymbol`/`windowSymbol`, the `stairs*` family,
 * `deviceWorldPlacement`, the pictogram registry, `wirePathData`,
 * `dimensionLayout`, `labelBounds`) so the file matches the canvas 1:1 and
 * there is one geometry path to test. Coordinates are real inches; layers are
 * named `<g>` groups. The underlay is embedded as a data URI ONLY when a
 * caller resolves it first via `embedUnderlay` and passes it in — the pure
 * builder never touches the network, so a default export can never leak
 * `/api/assets` (spec U4).
 */

/** A resolved underlay ready to inline: its bytes as a data URI plus pixel size. */
export interface UnderlayEmbed {
  dataUri: string
  pixelWidth: number
  pixelHeight: number
}

/** Options controlling what `buildPlanSvg` emits (spec X4). */
export interface SvgExportOptions {
  /** Embed the underlay image group (spec U4); requires `underlay` to be resolved. */
  includeUnderlay?: boolean
  /** Emit the labels + dimensions group (spec X4). Defaults to true. */
  includeAnnotations?: boolean
  /** Circuits whose wires to include, or `'all'` (default). */
  circuitIds?: 'all' | readonly string[]
  /** Background fill; `null` for a transparent file. Defaults to the canvas colour. */
  background?: string | null
  /** The resolved underlay bytes/size (see `embedUnderlay`); needed with `includeUnderlay`. */
  underlay?: UnderlayEmbed | null
}

const COORD_DECIMALS = 4

function num(value: number): number {
  return Number(value.toFixed(COORD_DECIMALS))
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Kebab-case slug of a circuit name for a stable, id-safe group id (spec X2). */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'circuit' : slug
}

function pointsAttr(points: readonly Point[]): string {
  return points.map((p) => `${num(p.x)},${num(p.y)}`).join(' ')
}

function line(a: Point, b: Point, stroke: string, width: number): string {
  return `<line x1="${num(a.x)}" y1="${num(a.y)}" x2="${num(b.x)}" y2="${num(b.y)}" stroke="${stroke}" stroke-width="${width}" />`
}

/** Render-time T-junction butting, mirroring `WallsLayer.renderVertices` (spec S1b). */
function renderWallVertices(wall: Wall, wallsById: ReadonlyMap<string, Wall>): Point[] {
  let vertices: Point[] = wall.vertices.map((v) => ({ ...v }))
  for (const junction of wall.junctions) {
    const host = wallsById.get(junction.host_wall_id)
    if (!host || host.id === wall.id) continue
    vertices = trimEndpointToHostFace(vertices, junction.end, {
      vertices: host.vertices,
      thicknessIn: host.thickness_in,
      reference: host.reference,
      closed: host.closed,
    })
  }
  return vertices
}

function wallPathData(wall: Wall, wallsById: ReadonlyMap<string, Wall>): string {
  return ringsToPath(
    wallOutline({
      vertices: renderWallVertices(wall, wallsById),
      thicknessIn: wall.thickness_in,
      reference: wall.reference,
      closed: wall.closed,
    }),
  )
}

function renderWalls(walls: readonly Wall[], wallsById: ReadonlyMap<string, Wall>): string[] {
  const out: string[] = []
  for (const wall of walls) {
    const d = wallPathData(wall, wallsById)
    if (d === '') continue
    out.push(
      `<path d="${d}" fill="${EXPORT_WALL_FILL}" fill-rule="evenodd" stroke="${EXPORT_WALL_EDGE}" stroke-width="${STRUCTURE_STROKE_IN}" />`,
    )
  }
  return out
}

function renderOpening(opening: Opening, wall: Wall, background: string): string[] {
  const inflated = openingWorldRect(wall, opening, STRUCTURE_STROKE_IN)
  const exact = openingWorldRect(wall, opening)
  if (!inflated || !exact) return []
  const out: string[] = [
    `<polygon points="${pointsAttr(inflated)}" fill="${background}" stroke="none" />`,
    line(exact[0], exact[3], EXPORT_WALL_EDGE, STRUCTURE_STROKE_IN),
    line(exact[1], exact[2], EXPORT_WALL_EDGE, STRUCTURE_STROKE_IN),
  ]
  if (opening.kind === 'door') {
    const door = doorSymbol(wall, opening)
    if (door) {
      out.push(
        `<path d="M ${num(door.hinge.x)} ${num(door.hinge.y)} L ${num(door.leafEnd.x)} ${num(door.leafEnd.y)} A ${num(door.radiusIn)} ${num(door.radiusIn)} 0 0 ${door.sweep} ${num(door.arcEnd.x)} ${num(door.arcEnd.y)}" fill="none" stroke="${EXPORT_WALL_EDGE}" stroke-width="${STRUCTURE_STROKE_IN}" />`,
      )
    }
  } else {
    for (const pane of windowSymbol(wall, opening) ?? []) {
      out.push(line(pane.a, pane.b, EXPORT_WALL_EDGE, STRUCTURE_STROKE_IN))
    }
  }
  return out
}

const STAIRS_ARROW_HEAD_IN = 6

function renderStairs(stairs: Stairs): string[] {
  if (stairs.length_in <= 0 || stairs.width_in <= 0) return []
  const arrow = stairsArrow(stairs)
  const centre = stairsCenter(stairs)
  const out: string[] = [
    `<polygon points="${pointsAttr(stairsCorners(stairs))}" fill="none" stroke="${EXPORT_INK_MUTED}" stroke-width="${ANNOTATION_STROKE_IN}" />`,
  ]
  for (const tread of stairsTreads(stairs)) {
    out.push(line(tread.a, tread.b, EXPORT_INK_MUTED, ANNOTATION_STROKE_IN))
  }
  out.push(line(arrow.tail, arrow.head, EXPORT_INK_MUTED, 1.5 * ANNOTATION_STROKE_IN))
  for (const stroke of arrowHeadStrokes(arrow.tail, arrow.head, STAIRS_ARROW_HEAD_IN)) {
    out.push(line(stroke.a, stroke.b, EXPORT_INK_MUTED, 1.5 * ANNOTATION_STROKE_IN))
  }
  out.push(
    `<text x="${num(centre.x)}" y="${num(centre.y)}" font-size="${ANNOTATION_TEXT_IN}" text-anchor="middle" dominant-baseline="central" fill="${EXPORT_INK_MUTED}" font-family="sans-serif">${escapeXml(stairs.direction)}</text>`,
  )
  return out
}

/** Renders one pictogram shape, in the symbol's 12x12 coordinate box. */
function renderPictogramShape(shape: PictogramShape): string {
  const stroke = `stroke="${EXPORT_INK}" stroke-width="${DEVICE_STROKE_IN}" stroke-linecap="round" stroke-linejoin="round"`
  switch (shape.kind) {
    case 'circle':
      return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${shape.fill ? EXPORT_INK : 'none'}" ${stroke} />`
    case 'line':
      return `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" ${stroke} />`
    case 'polyline': {
      const pts = shape.closed ? [...shape.points, shape.points[0]] : shape.points
      return `<polyline points="${pts.map(([x, y]) => `${x},${y}`).join(' ')}" fill="none" ${stroke} />`
    }
    case 'path':
      return `<path d="${shape.d}" fill="none" ${stroke} />`
    case 'rect':
      return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" fill="${shape.fill ? EXPORT_INK : 'none'}" ${stroke} />`
    case 'text':
      return `<text x="${shape.x}" y="${shape.y}" font-size="${shape.size}" fill="${EXPORT_INK}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif">${escapeXml(shape.text)}</text>`
  }
}

function renderDevice(device: Device, walls: readonly Wall[]): string[] {
  const placement = deviceWorldPlacement(device, walls)
  if (!placement) return []
  if (placement.baseboardRect) {
    return [
      `<polygon points="${pointsAttr(placement.baseboardRect)}" fill="none" stroke="${EXPORT_INK}" stroke-width="${1.2 * DEVICE_STROKE_IN}" />`,
    ]
  }
  const { position, angleDeg } = placement
  // The pictogram box is authored on [0,12]^2 with the anchor at (6,6); shift it
  // so (6,6) lands on the world position, then rotate about that anchor.
  const shapes = DEVICE_PICTOGRAMS[device.type].map(renderPictogramShape).join('')
  return [
    `<g transform="translate(${num(position.x)} ${num(position.y)}) rotate(${num(angleDeg)}) translate(-6 -6)">${shapes}</g>`,
  ]
}

function circuitWireGroup(
  circuit: Circuit,
  wires: readonly Wire[],
  document: PlanDocument,
): string {
  const devicesById = new Map(document.devices.map((device) => [device.id, device]))
  const paths: string[] = []
  for (const wire of wires) {
    const from = wireEndpoint(devicesById.get(wire.from_device_id), document.walls)
    const to = wireEndpoint(devicesById.get(wire.to_device_id), document.walls)
    if (!from || !to) continue
    paths.push(
      `<path d="${wirePathData(from, wire.control_points, to)}" fill="none" stroke="${circuit.color}" stroke-width="${WIRE_STROKE_IN}" stroke-linecap="round" />`,
    )
  }
  if (paths.length === 0) return ''
  return `<g id="circuit-${slugify(circuit.name)}" data-circuit="${escapeXml(circuit.name)}">${paths.join('')}</g>`
}

function renderLabel(label: Label): string {
  return `<text x="${num(label.position.x)}" y="${num(label.position.y)}" font-size="${num(labelFontSizeIn(label.size_in))}" fill="${EXPORT_INK}" font-family="sans-serif">${escapeXml(label.text)}</text>`
}

function renderDimension(dimension: Dimension, precisionIn?: number): string[] {
  const layout = dimensionLayout(dimension)
  if (!layout) return []
  const out: string[] = []
  for (const extension of layout.extensions) {
    out.push(line(extension.a, extension.b, EXPORT_INK_MUTED, ANNOTATION_STROKE_IN))
  }
  out.push(line(layout.line.a, layout.line.b, EXPORT_INK_MUTED, ANNOTATION_STROKE_IN))
  for (const tick of layout.ticks) {
    out.push(line(tick.a, tick.b, EXPORT_INK_MUTED, 1.5 * ANNOTATION_STROKE_IN))
  }
  out.push(
    `<text x="${num(layout.textAnchor.x)}" y="${num(layout.textAnchor.y)}" font-size="${ANNOTATION_TEXT_IN}" text-anchor="middle" fill="${EXPORT_INK}" stroke="${EXPORT_CANVAS}" stroke-width="${TEXT_HALO_STROKE_IN}" paint-order="stroke" font-family="sans-serif" transform="rotate(${num(layout.textAngleDeg)} ${num(layout.textAnchor.x)} ${num(layout.textAnchor.y)})">${escapeXml(formatFeetInches(layout.distanceIn, precisionIn))}</text>`,
  )
  return out
}

/** World-space corners of the underlay image, applying its calibration transform. */
function underlayCorners(underlay: Underlay, embed: UnderlayEmbed): Point[] {
  const { origin, rotation_deg: rotationDeg, scale } = underlay.transform
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const pixels: Point[] = [
    { x: 0, y: 0 },
    { x: embed.pixelWidth, y: 0 },
    { x: embed.pixelWidth, y: embed.pixelHeight },
    { x: 0, y: embed.pixelHeight },
  ]
  return pixels.map((p) => {
    const sx = p.x * scale
    const sy = p.y * scale
    return { x: origin.x + sx * cos - sy * sin, y: origin.y + sx * sin + sy * cos }
  })
}

function mergeBounds(target: Bounds | null, points: readonly Point[]): Bounds | null {
  const next = boundsOfPoints(points)
  if (!next) return target
  if (!target) return next
  return {
    minX: Math.min(target.minX, next.minX),
    minY: Math.min(target.minY, next.minY),
    maxX: Math.max(target.maxX, next.maxX),
    maxY: Math.max(target.maxY, next.maxY),
  }
}

/** Content bounds of everything rendered, before the export margin (spec X2). */
function contentBounds(
  document: PlanDocument,
  wallsById: ReadonlyMap<string, Wall>,
  options: Required<Pick<SvgExportOptions, 'includeUnderlay' | 'includeAnnotations'>>,
  underlay: UnderlayEmbed | null,
): Bounds | null {
  let bounds: Bounds | null = null
  for (const wall of document.walls) {
    bounds = mergeBounds(
      bounds,
      wallOutline({
        vertices: renderWallVertices(wall, wallsById),
        thicknessIn: wall.thickness_in,
        reference: wall.reference,
        closed: wall.closed,
      }).flat(),
    )
  }
  for (const opening of document.openings) {
    const wall = wallsById.get(opening.wall_id)
    const rect = wall ? openingWorldRect(wall, opening) : null
    if (rect) bounds = mergeBounds(bounds, rect)
  }
  for (const stairs of document.stairs) {
    bounds = mergeBounds(bounds, stairsCorners(stairs))
  }
  for (const device of document.devices) {
    const placement = deviceWorldPlacement(device, document.walls)
    if (placement) bounds = mergeBounds(bounds, placement.bounds)
  }
  const devicesById = new Map(document.devices.map((device) => [device.id, device]))
  for (const wire of document.wires) {
    const from = wireEndpoint(devicesById.get(wire.from_device_id), document.walls)
    const to = wireEndpoint(devicesById.get(wire.to_device_id), document.walls)
    if (from && to) bounds = mergeBounds(bounds, [from, ...wire.control_points, to])
  }
  if (options.includeAnnotations) {
    for (const label of document.labels) {
      const b = labelBounds(label)
      bounds = mergeBounds(bounds, [
        { x: b.minX, y: b.minY },
        { x: b.maxX, y: b.maxY },
      ])
    }
    for (const dimension of document.dimensions) {
      const layout = dimensionLayout(dimension)
      if (layout)
        bounds = mergeBounds(bounds, [layout.line.a, layout.line.b, dimension.p1, dimension.p2])
    }
  }
  if (options.includeUnderlay && document.underlay && underlay) {
    bounds = mergeBounds(bounds, underlayCorners(document.underlay, underlay))
  }
  return bounds
}

/** A small default viewBox when the document is empty (a 10' square at origin). */
const EMPTY_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 120, maxY: 120 }

/** The real-inch viewBox of an export: content bounds grown by the margin (spec X2). */
export interface PlanViewBox {
  minX: number
  minY: number
  width: number
  height: number
}

/**
 * The real-inch viewBox `buildPlanSvg` would emit for a document (spec X2):
 * the bounds of every included element plus the export margin. Pure; shared
 * with PNG export so raster size is computed from the same geometry.
 */
export function planViewBox(document: PlanDocument, options: SvgExportOptions = {}): PlanViewBox {
  const wallsById = new Map(document.walls.map((wall) => [wall.id, wall]))
  const raw =
    contentBounds(
      document,
      wallsById,
      {
        includeUnderlay: options.includeUnderlay ?? false,
        includeAnnotations: options.includeAnnotations ?? true,
      },
      options.underlay ?? null,
    ) ?? EMPTY_BOUNDS
  return {
    minX: raw.minX - EXPORT_MARGIN_IN,
    minY: raw.minY - EXPORT_MARGIN_IN,
    width: Math.max(1, raw.maxX - raw.minX + 2 * EXPORT_MARGIN_IN),
    height: Math.max(1, raw.maxY - raw.minY + 2 * EXPORT_MARGIN_IN),
  }
}

/**
 * Serialises a plan document to a standalone, real-inch SVG string (spec X2).
 * Pure: no network, no DOM. Include the underlay only by resolving it first
 * with `embedUnderlay` and passing it via `options.underlay`.
 */
export function buildPlanSvg(document: PlanDocument, options: SvgExportOptions = {}): string {
  const includeUnderlay = options.includeUnderlay ?? false
  const includeAnnotations = options.includeAnnotations ?? true
  const background = options.background === undefined ? EXPORT_CANVAS : options.background
  const underlayEmbed = options.underlay ?? null
  const wallsById = new Map(document.walls.map((wall) => [wall.id, wall]))

  const { minX, minY, width, height } = planViewBox(document, options)

  const groups: string[] = []

  if (includeUnderlay && document.underlay && underlayEmbed) {
    const t = document.underlay.transform
    groups.push(
      `<g id="underlay" opacity="${document.underlay.opacity}" transform="translate(${num(t.origin.x)} ${num(t.origin.y)}) rotate(${num(t.rotation_deg)}) scale(${t.scale})">` +
        `<image href="${underlayEmbed.dataUri}" width="${underlayEmbed.pixelWidth}" height="${underlayEmbed.pixelHeight}" /></g>`,
    )
  }

  const structure = [
    ...document.stairs.flatMap(renderStairs),
    ...renderWalls(document.walls, wallsById),
    ...document.openings.flatMap((opening) => {
      const wall = wallsById.get(opening.wall_id)
      return wall ? renderOpening(opening, wall, background ?? EXPORT_CANVAS) : []
    }),
  ]
  groups.push(`<g id="structure">${structure.join('')}</g>`)

  const allowedCircuits =
    options.circuitIds === undefined || options.circuitIds === 'all'
      ? null
      : new Set(options.circuitIds)
  for (const circuit of document.circuits) {
    if (allowedCircuits && !allowedCircuits.has(circuit.id)) continue
    const wires = document.wires.filter((wire) => wire.circuit_id === circuit.id)
    const group = circuitWireGroup(circuit, wires, document)
    if (group !== '') groups.push(group)
  }

  const devices = document.devices.flatMap((device) => renderDevice(device, document.walls))
  groups.push(`<g id="devices">${devices.join('')}</g>`)

  if (includeAnnotations) {
    // Dimension texts honour the plan's display precision (spec §5.9 tier 2)
    // so the export matches the on-canvas annotations.
    const annotations = [
      ...document.labels.map(renderLabel),
      ...document.dimensions.flatMap((dimension) =>
        renderDimension(dimension, document.display_precision_in ?? undefined),
      ),
    ]
    groups.push(`<g id="annotations">${annotations.join('')}</g>`)
  }

  const backgroundRect =
    background === null
      ? ''
      : `<rect x="${num(minX)}" y="${num(minY)}" width="${num(width)}" height="${num(height)}" fill="${background}" />`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${num(width)}in" height="${num(height)}in" ` +
    `viewBox="${num(minX)} ${num(minY)} ${num(width)} ${num(height)}">` +
    backgroundRect +
    groups.join('') +
    `</svg>`
  )
}

/**
 * Fetches an underlay asset and resolves it to an inlinable data URI (spec U4).
 * The caller supplies the natural pixel size (the editor already loaded it);
 * this only performs the fetch + base64 encode, keeping it testable.
 *
 * @param underlay The document underlay (its `image_ref` names the asset).
 * @param pixelSize The image's natural pixel dimensions.
 */
export async function embedUnderlay(
  underlay: Underlay,
  pixelSize: { width: number; height: number },
): Promise<UnderlayEmbed> {
  const response = await fetch(assetUrl(underlay.image_ref))
  if (!response.ok) {
    throw new Error(`Failed to load underlay image (status ${response.status})`)
  }
  const blob = await response.blob()
  const dataUri = await blobToDataUri(blob)
  return { dataUri, pixelWidth: pixelSize.width, pixelHeight: pixelSize.height }
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read underlay image'))
    reader.readAsDataURL(blob)
  })
}
