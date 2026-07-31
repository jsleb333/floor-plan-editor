"""Cross-language contract tests for forward migration, driven by a shared corpus."""

import json
from pathlib import Path
from typing import Any

import pytest
from backend.constants import CURRENT_SCHEMA_VERSION, LEGACY_SCHEMA_VERSION
from backend.core.errors import InvalidSchemaVersionError, UnsupportedSchemaVersionError
from backend.core.plan_migrator import PlanMigrator
from backend.models.plan_document import PlanDocument


PLAN_MIGRATION_FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "plan_migration"

# The bundled demo plan: a genuine schema v5 document, not a fixture written for
# a test, so it is the one case where the corpus runs against real content.
DEMO_DOCUMENT_PATH = (
    Path(__file__).resolve().parents[2] / "backend" / "app" / "demo" / "basement_demo.json"
)

# The ``expected_error`` codes a fixture may name, mirroring the ``code`` of the
# frontend error classes in ``frontend/src/schema/planDocumentSchema.ts``.
ERROR_CLASSES_BY_CODE: dict[str, type[Exception]] = {
    "unsupported_schema_version": UnsupportedSchemaVersionError,
    "invalid_schema_version": InvalidSchemaVersionError,
}


def _load_corpus_fixtures() -> list[dict[str, Any]]:
    """Load every scenario in the fixture corpus shared with the frontend mirror.

    Each JSON file under ``tests/fixtures/plan_migration/`` holds a
    ``{name, description, input}`` scenario plus either an ``expected_document``
    or an ``expected_error``, asserted identically by this suite and by
    ``frontend/tests/schema/planMigrationCorpus.test.ts``. Migration logic added
    to only one of the two implementations fails one of the two suites.
    """
    return [
        json.loads(path.read_text()) for path in sorted(PLAN_MIGRATION_FIXTURES_DIR.glob("*.json"))
    ]


PLAN_MIGRATION_CORPUS = _load_corpus_fixtures()
DOCUMENT_FIXTURES = [
    fixture for fixture in PLAN_MIGRATION_CORPUS if "expected_document" in fixture
]
ERROR_FIXTURES = [fixture for fixture in PLAN_MIGRATION_CORPUS if "expected_error" in fixture]


class TestPlanMigrationCorpus:
    @pytest.fixture
    def migrator(self) -> PlanMigrator:
        """Migrator under test, with its real step table."""
        return PlanMigrator()

    def test_corpus_fixtures__when_discovered_via_glob__cover_both_outcomes(self) -> None:
        """Guards against a bad glob path silently turning the corpus-driven tests below into no-ops."""
        assert len(DOCUMENT_FIXTURES) > 0
        assert len(ERROR_FIXTURES) > 0
        assert len(DOCUMENT_FIXTURES) + len(ERROR_FIXTURES) == len(PLAN_MIGRATION_CORPUS)

    def test_migration_steps__when_registered__cover_every_version_below_the_current_one(
        self, migrator: PlanMigrator
    ) -> None:
        """Drift guard mirrored in the frontend suite: the step table must be exactly the contiguous versions 1..9, so adding a v11 on one side fails the other until both move."""
        assert CURRENT_SCHEMA_VERSION == 10
        assert LEGACY_SCHEMA_VERSION == 1
        assert sorted(migrator._steps) == list(
            range(LEGACY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION)
        )

    @pytest.mark.parametrize(
        "fixture", DOCUMENT_FIXTURES, ids=[fixture["name"] for fixture in DOCUMENT_FIXTURES]
    )
    def test_migrate__against_shared_corpus__reaches_the_expected_document(
        self, migrator: PlanMigrator, fixture: dict[str, Any]
    ) -> None:
        """Cross-language contract: every scenario in tests/fixtures/plan_migration/ must reach the same v10 document here and in the frontend `planMigrationCorpus.test.ts` mirror, which reads the same file with `readPlanDocument`."""
        migrated, _ = migrator.migrate(fixture["input"])

        document = PlanDocument.model_validate(migrated)

        assert document.model_dump(mode="json") == fixture["expected_document"]

    @pytest.mark.parametrize(
        "fixture", ERROR_FIXTURES, ids=[fixture["name"] for fixture in ERROR_FIXTURES]
    )
    def test_migrate__against_shared_corpus__refuses_with_the_expected_error(
        self, migrator: PlanMigrator, fixture: dict[str, Any]
    ) -> None:
        """A version this build cannot read must be refused, not repaired: the frontend mirror asserts the same code on its own error classes."""
        with pytest.raises(ERROR_CLASSES_BY_CODE[fixture["expected_error"]]):
            migrator.migrate(fixture["input"])

    def test_migrate__when_given_the_bundled_demo_plan__reaches_the_documented_v10_shape(
        self, migrator: PlanMigrator
    ) -> None:
        """The seeded demo is real v5 content: 9 walls, 9 openings, 49 devices. Its v10 shape is the input plus exactly the six document slots added since, a colour and no junctions on every wall, a door style on every opening and an unset depth on every device — and the frontend mirror asserts this same expectation, element for element."""
        raw: dict[str, Any] = json.loads(DEMO_DOCUMENT_PATH.read_text())
        expected = {
            **raw,
            "schema_version": 10,
            "joints": [],
            "guides": [],
            "preset_lists": {},
            "display_precision_in": None,
            "active_tool": None,
            "active_mode": None,
            "walls": [
                {
                    "color": None,
                    **{key: value for key, value in wall.items() if key != "junctions"},
                }
                for wall in raw["walls"]
            ],
            "openings": [{"style": "swing", **opening} for opening in raw["openings"]],
            "devices": [{"depth_in": None, **device} for device in raw["devices"]],
        }

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert PlanDocument.model_validate(migrated).model_dump(mode="json") == expected
