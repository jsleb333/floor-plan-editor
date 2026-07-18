import type { Plan, PlanDocument } from '@/types/plan'

/**
 * Lossless JSON export/import of a plan document (spec X1). The exported file
 * wraps the full persistence document in a small envelope; re-importing an
 * exported file yields the identical document (round-trip identity), and the
 * backend re-validates the document on the next autosave `PUT`, so import
 * validation here is intentionally minimal — enough to reject a file that is
 * obviously not a plan.
 */

/** The app identifier stamped into every exported file's envelope. */
export const EXPORT_APP_ID = 'floor-plan-editor'

/** The on-disk shape of an exported plan file (spec X1). */
export interface PlanExportEnvelope {
  app: typeof EXPORT_APP_ID
  exported_at: string
  name: string
  document: PlanDocument
}

/** The result of importing a plan file: a name and a validated document (spec X1). */
export interface ImportedPlan {
  name: string
  document: PlanDocument
}

/**
 * Serialises a plan to a pretty-printed JSON blob (spec X1). The `exported_at`
 * timestamp is passed in by the caller so this stays a pure transformation and
 * the envelope is deterministic in tests.
 *
 * @param plan The plan whose document to export.
 * @param exportedAt ISO-8601 export timestamp for the envelope.
 */
export function exportPlanJson(plan: Pick<Plan, 'name' | 'document'>, exportedAt: string): Blob {
  const envelope: PlanExportEnvelope = {
    app: EXPORT_APP_ID,
    exported_at: exportedAt,
    name: plan.name,
    document: plan.document,
  }
  return new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Minimal shape check: a plan document has a numeric `schema_version` and a viewport. */
function isPlanDocument(value: unknown): value is PlanDocument {
  if (!isObject(value)) return false
  return typeof value.schema_version === 'number' && isObject(value.viewport)
}

/**
 * Parses and minimally validates an exported plan file (spec X1). Accepts both
 * the enveloped export shape and a bare document. Throws a clear error when the
 * file is not valid JSON or does not carry a plan document; the backend
 * re-validates fully on save.
 *
 * @param file The user-selected `.json` file.
 */
export async function importPlanJson(file: File): Promise<ImportedPlan> {
  const text = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  if (isObject(parsed) && parsed.app === EXPORT_APP_ID && isPlanDocument(parsed.document)) {
    const name =
      typeof parsed.name === 'string' && parsed.name.trim() !== '' ? parsed.name : 'Imported plan'
    return { name, document: parsed.document }
  }
  if (isPlanDocument(parsed)) {
    return { name: fileBaseName(file.name), document: parsed }
  }
  throw new Error('This file does not contain a floor-plan document.')
}

/** The file name without its extension, for a fallback plan name. */
function fileBaseName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim()
  return base === '' ? 'Imported plan' : base
}
