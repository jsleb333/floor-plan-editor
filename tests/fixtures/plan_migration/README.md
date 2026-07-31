# Plan migration corpus

One JSON file per scenario, loaded by **both** implementations of forward
migration so they cannot drift apart:

- `tests/core/test_plan_migration_corpus.py` asserts
  `PlanDocument.model_validate(PlanMigrator().migrate(input)[0]).model_dump(mode="json")`
  equals `expected_document`.
- `frontend/tests/schema/planMigrationCorpus.test.ts` asserts
  `readPlanDocument(input).document` equals the same `expected_document`.

The backend walks nine ordered steps; the frontend reaches the same place in one
pass, because every step only gives a newly added field its default (which the
Zod `.default()`s do on read) and the two steps that instead drop data — a
pre-v10 wall's `junctions` — are covered by `z.object` stripping unknown keys.
This corpus is what makes that claim testable rather than asserted.

## File shape

```jsonc
{
  "name": "v9-junctions-dropped",        // matches the file name after the NNN- prefix
  "description": "Why this scenario exists and what it pins down.",
  "input": { "schema_version": 9, "...": "..." },
  "expected_document": { "schema_version": 10, "...": "..." }
}
```

A scenario that must be refused instead carries an error code and no
`expected_document`:

```jsonc
{ "name": "...", "description": "...", "input": {}, "expected_error": "unsupported_schema_version" }
```

The codes are the `code` of the frontend error classes in
`planDocumentSchema.ts`; the Python suite maps each to its domain exception.

## Two rules for adding a fixture

**1. Write `expected_document` by hand, from each step's stated intent — never by
dumping a run of either implementation.** An expectation regenerated from the
code under test only proves the code agrees with itself: it would happily pin a
bug in place, and it would pin it identically on both sides the moment one side
is used to generate it. Read the migration step's docstring, decide what the
document *should* look like, and write that. `expected_document` is the full
validated document, so every field the schema defines is present.

**2. Put nothing in `input` that is invalid rather than merely old.** A fixture
document may differ from a current one only by its version and by the fields
added since — that is what both sides agree about. Hostile content does not
belong here: Pydantic *rejects* a malformed element while the frontend reader
*repairs* it, so the two sides would legitimately disagree and the corpus would
be asserting a contradiction. Repair behaviour is covered by the
frontend-only tests in `frontend/tests/schema/planDocumentSchema.test.ts`.
