import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { PlanDocument, PlanValidation } from '@/types/plan'
import { validatePlan } from '@/utils/circuits'

/**
 * Cross-language contract test: loads the SAME fixture corpus consumed by the
 * backend's `test_circuit_validation_service.py` (`tests/fixtures/circuit_validation/`,
 * two directories above `frontend/`) and asserts `validatePlan` reproduces the
 * backend `CircuitValidationService` result for every scenario. A rule added
 * to only one implementation fails this suite or the backend one.
 */
interface CircuitValidationFixture {
  name: string
  description: string
  document: PlanDocument
  expected: PlanValidation
}

const currentDir = dirname(fileURLToPath(import.meta.url))
const CORPUS_DIR = resolve(currentDir, '../../../tests/fixtures/circuit_validation')

function loadCorpusFixtures(): CircuitValidationFixture[] {
  return readdirSync(CORPUS_DIR)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort()
    .map((fileName) => {
      const raw = readFileSync(resolve(CORPUS_DIR, fileName), 'utf-8')
      return JSON.parse(raw) as CircuitValidationFixture
    })
}

const corpus = loadCorpusFixtures()

describe('validatePlan against the shared circuit-validation corpus', () => {
  it('discovers a non-empty corpus (guards against a bad glob silently passing)', () => {
    expect(corpus.length).toBeGreaterThan(0)
  })

  for (const fixture of corpus) {
    it(`matches the backend result: ${fixture.name}`, () => {
      expect(validatePlan(fixture.document)).toEqual(fixture.expected)
    })
  }
})
