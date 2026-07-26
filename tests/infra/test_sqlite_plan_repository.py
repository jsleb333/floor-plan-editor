"""Tests for SqlitePlanRepository against a real SQLite database."""

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

import aiosqlite
import pytest
from backend.infra.sqlite_plan_repository import SqlitePlanRepository
from backend.models.plan import Plan
from backend.models.plan_document import PlanDocument
from backend.models.point import Point
from backend.models.viewport import Viewport
from backend.models.wall import Wall


def _make_plan(plan_id: str = "plan-1", name: str = "Basement", **overrides: object) -> Plan:
    """Build a valid plan with sensible defaults, overridable per test."""
    fields: dict[str, object] = {
        "id": plan_id,
        "name": name,
        "description": "",
        "revision": 1,
        "created_at": datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
        "updated_at": datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
        "archived_at": None,
        "document": PlanDocument(),
    }
    fields.update(overrides)
    return Plan.model_validate(fields)


class TestSqlitePlanRepository:
    @pytest.fixture
    async def connection(self, tmp_path: Path) -> AsyncIterator[aiosqlite.Connection]:
        """Open aiosqlite connection to a fresh database file, closed after the test."""
        connection = await aiosqlite.connect(tmp_path / "test.db")
        yield connection
        await connection.close()

    @pytest.fixture
    async def repository(self, connection: aiosqlite.Connection) -> SqlitePlanRepository:
        """Repository with its schema created on the fresh test database."""
        repository = SqlitePlanRepository(connection)
        await repository.initialize()
        return repository

    async def test_get_raw__when_plan_was_created__returns_metadata_and_raw_document(
        self, repository: SqlitePlanRepository
    ) -> None:
        """The stored row comes back with tz-aware timestamps and the document as a raw dict."""
        document = PlanDocument(
            viewport=Viewport(center=Point(x=12.5, y=-3.0), zoom=2.5),
            walls=[
                Wall(
                    id="w1",
                    vertices=[Point(x=0.0, y=0.0), Point(x=120.0, y=0.0)],
                    thickness_in=3.5,
                )
            ],
        )
        plan = _make_plan(
            document=document,
            archived_at=datetime(2026, 2, 1, tzinfo=UTC),
            description="traced from the hand-drawn plan",
        )

        await repository.create(plan)
        record = await repository.get_raw(plan.id)

        assert record is not None
        assert record.id == plan.id
        assert record.name == plan.name
        assert record.description == plan.description
        assert record.revision == plan.revision
        assert record.created_at == plan.created_at
        assert record.updated_at == plan.updated_at
        assert record.archived_at == plan.archived_at
        assert record.document == document.model_dump(mode="json")

    async def test_get_raw__when_id_is_unknown__returns_none(
        self, repository: SqlitePlanRepository
    ) -> None:
        assert await repository.get_raw("missing") is None

    async def test_list_summaries__when_plans_exist__returns_metadata_most_recent_first(
        self, repository: SqlitePlanRepository
    ) -> None:
        """Summaries expose id, name, description and timestamps, ordered by last update descending."""
        older = _make_plan(plan_id="old", updated_at=datetime(2026, 1, 1, tzinfo=UTC))
        newer = _make_plan(
            plan_id="new",
            updated_at=datetime(2026, 3, 1, tzinfo=UTC),
            description="the newest plan",
        )
        await repository.create(older)
        await repository.create(newer)

        summaries = await repository.list_summaries()

        assert [summary.id for summary in summaries] == ["new", "old"]
        assert summaries[0].name == newer.name
        assert summaries[0].description == "the newest plan"
        assert summaries[0].updated_at == newer.updated_at
        assert summaries[0].archived_at is None
        assert not summaries[1].description

    async def test_update_document__when_revision_matches__increments_revision_and_stores(
        self, repository: SqlitePlanRepository
    ) -> None:
        """A matching revision persists the new document and bumps the revision counter."""
        plan = _make_plan()
        await repository.create(plan)
        new_document = PlanDocument(viewport=Viewport(center=Point(x=100.0, y=200.0), zoom=0.5))
        new_time = datetime(2026, 4, 1, tzinfo=UTC)

        new_revision = await repository.update_document(plan.id, new_document, 1, new_time)
        record = await repository.get_raw(plan.id)

        assert new_revision == 2
        assert record is not None
        assert record.revision == 2
        assert record.document == new_document.model_dump(mode="json")
        assert record.updated_at == new_time

    async def test_update_document__when_revision_is_stale__returns_none_and_keeps_document(
        self, repository: SqlitePlanRepository
    ) -> None:
        """A stale revision leaves the stored document and revision untouched."""
        plan = _make_plan()
        await repository.create(plan)
        stale_document = PlanDocument(viewport=Viewport(center=Point(x=1.0, y=1.0), zoom=9.0))

        result = await repository.update_document(
            plan.id, stale_document, 99, datetime(2026, 4, 1, tzinfo=UTC)
        )
        record = await repository.get_raw(plan.id)

        assert result is None
        assert record is not None
        assert record.revision == 1
        assert record.document == plan.document.model_dump(mode="json")

    async def test_save_document_backup__when_same_version_saved_twice__keeps_the_oldest_copy(
        self, repository: SqlitePlanRepository, connection: aiosqlite.Connection
    ) -> None:
        """A second backup for the same plan and source version is ignored, preserving the pristine pre-migration copy."""
        first_document = json.dumps({"schema_version": 1, "marker": "original"})
        second_document = json.dumps({"schema_version": 1, "marker": "overwrite-attempt"})

        await repository.save_document_backup(
            "plan-1", 1, first_document, datetime(2026, 1, 1, tzinfo=UTC)
        )
        await repository.save_document_backup(
            "plan-1", 1, second_document, datetime(2026, 2, 1, tzinfo=UTC)
        )

        cursor = await connection.execute(
            "SELECT document, created_at FROM document_backups WHERE plan_id = ?", ("plan-1",)
        )
        backups = await cursor.fetchall()
        assert len(backups) == 1
        assert backups[0][0] == first_document
        assert backups[0][1] == datetime(2026, 1, 1, tzinfo=UTC).isoformat()

    async def test_save_document_backup__when_versions_differ__keeps_one_copy_per_version(
        self, repository: SqlitePlanRepository, connection: aiosqlite.Connection
    ) -> None:
        """Backups from different source schema versions coexist for the same plan."""
        await repository.save_document_backup(
            "plan-1", 1, json.dumps({"schema_version": 1}), datetime(2026, 1, 1, tzinfo=UTC)
        )
        await repository.save_document_backup(
            "plan-1", 2, json.dumps({"schema_version": 2}), datetime(2026, 2, 1, tzinfo=UTC)
        )

        cursor = await connection.execute(
            "SELECT from_version FROM document_backups WHERE plan_id = ? ORDER BY from_version",
            ("plan-1",),
        )
        backups = await cursor.fetchall()
        assert [row[0] for row in backups] == [1, 2]

    async def test_update_metadata__when_name_is_given__changes_name_and_keeps_description(
        self, repository: SqlitePlanRepository
    ) -> None:
        """A name-only update (inline rename) leaves the stored description untouched."""
        plan = _make_plan(description="the family basement")
        await repository.create(plan)
        new_time = datetime(2026, 5, 1, tzinfo=UTC)

        updated = await repository.update_metadata(plan.id, "Garage", None, new_time)
        record = await repository.get_raw(plan.id)

        assert updated is True
        assert record is not None
        assert record.name == "Garage"
        assert record.description == "the family basement"
        assert record.updated_at == new_time

    async def test_update_metadata__when_description_is_given__changes_it_and_keeps_name(
        self, repository: SqlitePlanRepository
    ) -> None:
        """A description-only update (Inspector plan settings) leaves the stored name untouched."""
        plan = _make_plan()
        await repository.create(plan)

        updated = await repository.update_metadata(
            plan.id, None, "traced from the photo", datetime(2026, 5, 1, tzinfo=UTC)
        )
        record = await repository.get_raw(plan.id)

        assert updated is True
        assert record is not None
        assert record.name == plan.name
        assert record.description == "traced from the photo"

    async def test_update_metadata__when_id_is_unknown__returns_false(
        self, repository: SqlitePlanRepository
    ) -> None:
        assert (
            await repository.update_metadata("missing", "Garage", None, datetime.now(UTC)) is False
        )

    async def test_initialize__when_table_predates_the_description_column__adds_it_keeping_rows(
        self, connection: aiosqlite.Connection
    ) -> None:
        """Re-initializing over a legacy database adds the description column additively; existing plans survive with an empty description."""
        await connection.execute(
            "CREATE TABLE plans (id TEXT PRIMARY KEY, name TEXT NOT NULL,"
            " revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,"
            " archived_at TEXT NULL, document TEXT NOT NULL)"
        )
        await connection.execute(
            "INSERT INTO plans (id, name, revision, created_at, updated_at, archived_at,"
            " document) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                "legacy-plan",
                "Basement",
                2,
                datetime(2026, 1, 1, tzinfo=UTC).isoformat(),
                datetime(2026, 2, 1, tzinfo=UTC).isoformat(),
                None,
                PlanDocument().model_dump_json(),
            ),
        )
        await connection.commit()
        repository = SqlitePlanRepository(connection)

        await repository.initialize()
        record = await repository.get_raw("legacy-plan")

        assert record is not None
        assert record.name == "Basement"
        assert not record.description
        assert record.revision == 2

    async def test_set_archived__when_toggled__stores_and_clears_archived_at(
        self, repository: SqlitePlanRepository
    ) -> None:
        """Archiving stores the timestamp; restoring clears it back to None."""
        plan = _make_plan()
        await repository.create(plan)
        archived_at = datetime(2026, 6, 1, tzinfo=UTC)

        archived = await repository.set_archived(plan.id, archived_at, archived_at)
        record_archived = await repository.get_raw(plan.id)
        restored = await repository.set_archived(plan.id, None, datetime.now(UTC))
        record_restored = await repository.get_raw(plan.id)

        assert archived is True
        assert record_archived is not None
        assert record_archived.archived_at == archived_at
        assert restored is True
        assert record_restored is not None
        assert record_restored.archived_at is None

    async def test_delete__when_plan_exists__removes_it(
        self, repository: SqlitePlanRepository
    ) -> None:
        plan = _make_plan()
        await repository.create(plan)

        deleted = await repository.delete(plan.id)

        assert deleted is True
        assert await repository.get_raw(plan.id) is None

    async def test_delete__when_id_is_unknown__returns_false(
        self, repository: SqlitePlanRepository
    ) -> None:
        assert await repository.delete("missing") is False
