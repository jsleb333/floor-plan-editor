import { readPlanDocument } from '@/schema/planDocumentSchema'
import type { DocumentIssue } from '@/schema/planDocumentSchema'
import type { Plan, PlanDocument } from '@/types/plan'

/**
 * Lossless JSON export/import of a plan document (spec X1). The exported file
 * wraps the full persistence document in a small envelope; re-importing an
 * exported file yields the identical document (round-trip identity).
 *
 * An imported file is the one document the app reads that no backend ever
 * validated — it may have been exported by an older build, hand-edited, or
 * truncated. Import therefore goes through `readPlanDocument`, the same funnel
 * that reads stored documents: it migrates an older file forward, repairs what
 * it can and reports the rest. Nothing downstream re-checks the shape, which is
 * why the shape check here cannot stay a two-field guess.
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
  /** The document, read through the funnel and stamped to the current version. */
  document: PlanDocument
  /** What the reader had to repair or drop; empty when the file read cleanly. */
  issues: DocumentIssue[]
  /** The older schema version the file carried, or `null` when it was already current. */
  migratedFrom: number | null
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

/**
 * Whether `value` is plausibly a plan document, i.e. worth handing to the
 * reader. Deliberately loose: the reader fills in everything that is missing, so
 * this only has to tell a plan apart from an unrelated JSON file — which means
 * accepting a legacy document that carries no `schema_version` at all (read as
 * version 1), and rejecting an object that carries none of a plan's own fields.
 */
function looksLikePlanDocument(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false
  return (
    typeof value.schema_version === 'number' ||
    isObject(value.viewport) ||
    Array.isArray(value.walls)
  )
}

/**
 * Parses and reads an exported plan file (spec X1). Accepts both the enveloped
 * export shape and a bare document, and brings an older file forward to the
 * current schema version. Throws when the file is not valid JSON, does not carry
 * a plan document, or was written by a newer build of the app — anything else is
 * repaired and reported in {@link ImportedPlan.issues}.
 *
 * @param file The user-selected `.json` file.
 * @throws {Error} When the file is not JSON or is not a plan document.
 * @throws {UnsupportedSchemaVersionError} When the file is newer than this build.
 * @throws {InvalidSchemaVersionError} When the file's schema version is not a number.
 */
export async function importPlanJson(file: File): Promise<ImportedPlan> {
  const text = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  const envelope = isObject(parsed) && parsed.app === EXPORT_APP_ID ? parsed : null
  const raw = envelope === null ? parsed : envelope.document
  if (!looksLikePlanDocument(raw)) {
    throw new Error('This file does not contain a floor-plan document.')
  }
  const envelopeName = envelope?.name
  const name =
    typeof envelopeName === 'string' && envelopeName.trim() !== ''
      ? envelopeName
      : fileBaseName(file.name)
  const { document, issues, fromVersion, migrated } = readPlanDocument(raw)
  return { name, document, issues, migratedFrom: migrated ? fromVersion : null }
}

/** The file name without its extension, for a fallback plan name. */
function fileBaseName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim()
  return base === '' ? 'Imported plan' : base
}
