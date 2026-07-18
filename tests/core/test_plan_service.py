"""Tests for PlanService business rules over a mocked repository.

The migration flow is additionally covered end-to-end against a real SQLite
database, since it spans the repository raw-read, backup and update paths.
"""

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, ClassVar
from unittest.mock import AsyncMock

import aiosqlite
import pytest
from backend.core.errors import PlanNotArchivedError, PlanNotFoundError, RevisionConflictError
from backend.core.plan_migrator import PlanMigrator
from backend.core.plan_service import PlanService
from backend.infra.sqlite_plan_repository import SqlitePlanRepository
from backend.interfaces.plan_repository import PlanRepository
from backend.models.plan_document import PlanDocument
from backend.models.point import Point
from backend.models.raw_plan_record import RawPlanRecord
from backend.models.viewport import Viewport


def _make_raw_record(archived_at: datetime | None = None) -> RawPlanRecord:
    """Build a stored plan record with a current-version document, as the repository returns it."""
    document = PlanDocument(viewport=Viewport(center=Point(x=5.0, y=6.0), zoom=3.0))
    return RawPlanRecord(
        id="source-id",
        name="Basement",
        revision=4,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 2, 1, tzinfo=UTC),
        archived_at=archived_at,
        document=document.model_dump(mode="json"),
    )


class TestPlanService:
    @pytest.fixture
    def repo(self) -> PlanRepository:
        """Repository mock honouring the PlanRepository port."""
        return AsyncMock(spec=PlanRepository)

    @pytest.fixture
    def service(self, repo: PlanRepository) -> PlanService:
        """Service under test wired to the mocked repository and a real migrator."""
        return PlanService(repo, PlanMigrator())

    async def test_create_plan__when_called__persists_fresh_plan_with_defaults(
        self, service: PlanService, repo: PlanRepository
    ) -> None:
        """A new plan starts at revision 1 with an empty schema v5 document, not archived."""
        plan = await service.create_plan("Basement")

        assert plan.name == "Basement"
        assert plan.revision == 1
        assert plan.archived_at is None
        assert plan.document.schema_version == 5
        assert plan.document.devices == []
        assert plan.document.circuits == []
        assert plan.document.wires == []
        assert plan.document.control_links == []
        assert plan.document.catalog_defaults == {}
        assert plan.document.underlay is None
        assert plan.document.viewport == Viewport(center=Point(x=0.0, y=0.0), zoom=1.0)
        assert plan.document.walls == []
        assert plan.document.thickness_presets_in == [12.0, 4.5, 3.5]
        assert plan.created_at == plan.updated_at
        repo.create.assert_awaited_once_with(plan)

    async def test_get_plan__when_id_is_unknown__raises_plan_not_found(
        self, service: PlanService, repo: PlanRepository
    ) -> None:
        repo.get_raw.return_value = None

        with pytest.raises(PlanNotFoundError):
            await service.get_plan("missing")

    async def test_get_plan__when_document_is_current__returns_plan_without_writing(
        self, service: PlanService, repo: PlanRepository
    ) -> None:
        """A current-version document is returned as stored; no backup or rewrite happens."""
        record = _make_raw_record()
        repo.get_raw.return_value = record

        plan = await service.get_plan(record.id)

        assert plan.revision == record.revision
        assert plan.document == PlanDocument.model_validate(record.document)
        repo.save_document_backup.assert_not_awaited()
        repo.update_document.assert_not_awaited()

    async def test_update_document__when_revision_is_stale_but_plan_exists__raises_conflict(
        self, service: PlanService, repo: PlanRepository
    ) -> None:
        """A rejected update on an existing plan is a revision conflict, not a missing plan."""
        repo.update_document.return_value = None
        repo.get_raw.return_value = _make_raw_record()

        with pytest.raises(RevisionConflictError):
            await service.update_document("source-id", PlanDocument(), expected_revision=3)

    async def test_update_document__when_plan_is_missing__raises_plan_not_found(
        self, service: PlanService, repo: PlanRepository
    ) -> None:
        repo.update_document.return_value = None
        repo.get_raw.return_value = None

        with pytest.raises(PlanNotFoundError):
            await service.update_document("missing", PlanDocument(), expected_revision=1)

    async def test_update_document__when_revision_matches__returns_new_revision(
        self, service: PlanService, repo: PlanRepository
    ) -> None:
        repo.update_document.return_value = 5

        revision = await service.update_document("source-id", PlanDocument(), expected_revision=4)

        assert revision == 5

    async def test_update_document__when_body_claims_an_old_schema_version__stores_current_version(
        self, service: PlanService, repo: PlanRepository
    ) -> None:
        """A v2-shaped body validated against the current model is persisted claiming schema v5, not the stale v2 it was sent with."""
        repo.update_document.return_value = 5
        v2_shaped = PlanDocument.model_validate({
            "schema_version": 2,
            "viewport": {"center": {"x": 0.0, "y": 0.0}, "zoom": 1.0},
        })

        await service.update_document("source-id", v2_shaped, expected_revision=4)

        stored_document = repo.update_document.await_args.args[1]
        assert stored_document.schema_version == 5
        assert stored_document.underlay is None
        assert stored_document.viewport == v2_shaped.viewport

    async def test_duplicate_plan__when_source_exists__creates_copy_with_fresh_identity(
        self, service: PlanService, repo: PlanRepository
    ) -> None:
        """The duplicate carries the source document but a new id, copy name and revision 1."""
        source = _make_raw_record()
        repo.get_raw.return_value = source

        duplicate = await service.duplicate_plan(source.id)

        assert duplicate.id != source.id
        assert duplicate.name == "Basement (copy)"
        assert duplicate.revision == 1
        assert duplicate.archived_at is None
        assert duplicate.document == PlanDocument.model_validate(source.document)
        repo.create.assert_awaited_once_with(duplicate)

    async def test_delete_plan_permanently__when_plan_is_not_archived__raises_not_archived(
        self, service: PlanService, repo: PlanRepository
    ) -> None:
        """Permanent deletion refuses to destroy a plan that was never soft-deleted."""
        repo.get_raw.return_value = _make_raw_record(archived_at=None)

        with pytest.raises(PlanNotArchivedError):
            await service.delete_plan_permanently("source-id")

        repo.delete.assert_not_awaited()

    async def test_delete_plan_permanently__when_plan_is_archived__deletes_it(
        self, service: PlanService, repo: PlanRepository
    ) -> None:
        repo.get_raw.return_value = _make_raw_record(archived_at=datetime(2026, 3, 1, tzinfo=UTC))

        await service.delete_plan_permanently("source-id")

        repo.delete.assert_awaited_once_with("source-id")


class TestPlanServiceMigration:
    """Migration-on-read flow against a real SQLite database."""

    V1_DOCUMENT: ClassVar[dict[str, Any]] = {
        "schema_version": 1,
        "viewport": {"center": {"x": 24.0, "y": -12.0}, "zoom": 2.0},
    }

    @pytest.fixture
    async def connection(self, tmp_path: Path) -> AsyncIterator[aiosqlite.Connection]:
        """Open aiosqlite connection to a fresh database file, closed after the test."""
        connection = await aiosqlite.connect(tmp_path / "test.db")
        yield connection
        await connection.close()

    @pytest.fixture
    async def repository(self, connection: aiosqlite.Connection) -> SqlitePlanRepository:
        """Repository with its schema created, seeded with one plan stored at schema v1."""
        repository = SqlitePlanRepository(connection)
        await repository.initialize()
        await connection.execute(
            "INSERT INTO plans (id, name, revision, created_at, updated_at, archived_at,"
            " document) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                "v1-plan",
                "Basement",
                3,
                datetime(2026, 1, 1, tzinfo=UTC).isoformat(),
                datetime(2026, 2, 1, tzinfo=UTC).isoformat(),
                None,
                json.dumps(self.V1_DOCUMENT),
            ),
        )
        await connection.commit()
        return repository

    @pytest.fixture
    def service(self, repository: SqlitePlanRepository) -> PlanService:
        """Service under test over the real repository and migrator."""
        return PlanService(repository, PlanMigrator())

    async def test_get_plan__when_stored_document_is_v1__returns_migrated_v5_and_keeps_backup(
        self, service: PlanService, repository: SqlitePlanRepository
    ) -> None:
        """Reading a v1 plan returns a current-version document, persists it with a bumped revision and keeps the pristine pre-migration copy in document_backups."""
        plan = await service.get_plan("v1-plan")

        assert plan.document.schema_version == 5
        assert plan.document.viewport == Viewport(center=Point(x=24.0, y=-12.0), zoom=2.0)
        assert plan.document.walls == []
        assert plan.document.thickness_presets_in == [12.0, 4.5, 3.5]
        assert plan.document.underlay is None
        assert plan.document.devices == []
        assert plan.document.catalog_defaults == {}
        assert plan.document.circuits == []
        assert plan.document.wires == []
        assert plan.document.control_links == []
        assert plan.revision == 4

        stored = await repository.get_raw("v1-plan")
        assert stored is not None
        assert stored.revision == 4
        assert stored.document["schema_version"] == 5

        cursor = await repository._connection.execute(
            "SELECT from_version, document FROM document_backups WHERE plan_id = ?", ("v1-plan",)
        )
        backups = await cursor.fetchall()
        assert len(backups) == 1
        assert backups[0][0] == 1
        assert json.loads(backups[0][1]) == self.V1_DOCUMENT

    async def test_get_plan__when_read_twice__migrates_only_once(
        self, service: PlanService, repository: SqlitePlanRepository
    ) -> None:
        """The second read finds an already-current document and leaves the revision alone."""
        first = await service.get_plan("v1-plan")
        second = await service.get_plan("v1-plan")

        assert first.revision == 4
        assert second.revision == 4
        assert second.document == first.document
