import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  CURRENT_SCHEMA_VERSION,
  INVALID_SCHEMA_VERSION_CODE,
  LEGACY_SCHEMA_VERSION,
  UNSUPPORTED_SCHEMA_VERSION_CODE,
  readPlanDocument,
} from '@/schema/planDocumentSchema'

/**
 * Cross-language contract test: loads the SAME fixture corpus consumed by the
 * backend's `tests/core/test_plan_migration_corpus.py` (`tests/fixtures/plan_migration/`,
 * two directories above `frontend/`) and asserts `readPlanDocument` reaches the
 * v10 document the backend's nine-step `PlanMigrator` produces, for every
 * scenario. The backend walks the steps; this side gets there in one pass,
 * because every step only gives a newly added field its default. A migration
 * rule added to only one implementation fails this suite or the backend one.
 */
interface PlanMigrationFixture {
  name: string
  description: string
  input: unknown
  expected_document?: Record<string, unknown>
  expected_error?: string
}

/** The parts of the raw demo document this suite reads to build its expectation. */
interface RawDemoDocument extends Record<string, unknown> {
  walls: Record<string, unknown>[]
  openings: Record<string, unknown>[]
  devices: Record<string, unknown>[]
}

const currentDir = dirname(fileURLToPath(import.meta.url))
const CORPUS_DIR = resolve(currentDir, '../../../tests/fixtures/plan_migration')
/** The bundled demo plan, a genuine schema-v5 document with real content. */
const DEMO_DOCUMENT_PATH = resolve(currentDir, '../../../backend/app/demo/basement_demo.json')

function loadCorpusFixtures(): PlanMigrationFixture[] {
  return readdirSync(CORPUS_DIR)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort()
    .map((fileName) => {
      const raw = readFileSync(resolve(CORPUS_DIR, fileName), 'utf-8')
      return JSON.parse(raw) as PlanMigrationFixture
    })
}

const corpus = loadCorpusFixtures()
const documentFixtures = corpus.filter((fixture) => fixture.expected_document !== undefined)
const errorFixtures = corpus.filter((fixture) => fixture.expected_error !== undefined)

/** The `code` of the thrown error, or `null` when the value thrown carries none. */
function thrownCode(read: () => void): string | null {
  try {
    read()
  } catch (error) {
    return error instanceof Error && 'code' in error ? String(error.code) : null
  }
  return null
}

function withoutJunctions(wall: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(wall).filter(([key]) => key !== 'junctions'))
}

describe('readPlanDocument against the shared plan-migration corpus', () => {
  it('discovers a non-empty corpus covering both outcomes (guards a bad glob silently passing)', () => {
    expect(documentFixtures.length).toBeGreaterThan(0)
    expect(errorFixtures.length).toBeGreaterThan(0)
    expect(documentFixtures.length + errorFixtures.length).toBe(corpus.length)
  })

  it('is pinned to the same schema versions as the backend constants', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(10)
    expect(LEGACY_SCHEMA_VERSION).toBe(1)
  })

  for (const fixture of documentFixtures) {
    it(`reaches the document the backend migrator produces: ${fixture.name}`, () => {
      expect(readPlanDocument(fixture.input).document).toEqual(fixture.expected_document)
    })
  }

  for (const fixture of errorFixtures) {
    it(`refuses to read it, with the same error code: ${fixture.name}`, () => {
      expect(() => readPlanDocument(fixture.input)).toThrow()
      expect(thrownCode(() => readPlanDocument(fixture.input))).toBe(fixture.expected_error)
    })
  }

  it('names its error codes exactly as the corpus does', () => {
    expect(UNSUPPORTED_SCHEMA_VERSION_CODE).toBe('unsupported_schema_version')
    expect(INVALID_SCHEMA_VERSION_CODE).toBe('invalid_schema_version')
  })
})

describe('readPlanDocument on the bundled demo document', () => {
  const raw = JSON.parse(readFileSync(DEMO_DOCUMENT_PATH, 'utf-8')) as RawDemoDocument

  it('reaches the same v10 shape the backend migrator reaches', () => {
    const expected = {
      ...raw,
      schema_version: 10,
      joints: [],
      guides: [],
      preset_lists: {},
      display_precision_in: null,
      active_tool: null,
      active_mode: null,
      walls: raw.walls.map((wall) => ({ color: null, ...withoutJunctions(wall) })),
      openings: raw.openings.map((opening) => ({ style: 'swing', ...opening })),
      devices: raw.devices.map((device) => ({ depth_in: null, ...device })),
    }

    const { document, issues, fromVersion, migrated } = readPlanDocument(raw)

    expect(issues).toEqual([])
    expect(fromVersion).toBe(5)
    expect(migrated).toBe(true)
    expect(document).toEqual(expected)
  })
})
