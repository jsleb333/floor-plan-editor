"""Tests for DemoPlanSeeder over real repositories and a temporary database."""

from collections.abc import AsyncIterator
from pathlib import Path

import aiosqlite
import pytest
from backend.core.orchestrators import demo_plan_seeder
from backend.core.orchestrators.demo_plan_seeder import DemoPlanSeeder
from backend.core.plan_migrator import PlanMigrator
from backend.core.services.asset_service import AssetService
from backend.core.services.plan_service import PlanService
from backend.infra.file_asset_repository import FileAssetRepository
from backend.infra.sqlite_plan_repository import SqlitePlanRepository
from backend.settings import AppSettings


class TestDemoPlanSeeder:
    @pytest.fixture
    async def connection(self, tmp_path: Path) -> AsyncIterator[aiosqlite.Connection]:
        """Open aiosqlite connection to a fresh database file, closed after the test."""
        connection = await aiosqlite.connect(tmp_path / "test.db")
        yield connection
        await connection.close()

    @pytest.fixture
    async def plan_service(self, connection: aiosqlite.Connection) -> PlanService:
        """Plan service backed by a real SQLite repository on the test database."""
        repository = SqlitePlanRepository(connection)
        await repository.initialize()
        return PlanService(repository, PlanMigrator())

    @pytest.fixture
    async def asset_service(
        self, connection: aiosqlite.Connection, tmp_path: Path
    ) -> AssetService:
        """Asset service backed by a real file repository on a temporary data directory."""
        repository = FileAssetRepository(connection, tmp_path / "data")
        await repository.initialize()
        return AssetService(repository, AppSettings())

    @pytest.fixture
    def seeder(self, plan_service: PlanService, asset_service: AssetService) -> DemoPlanSeeder:
        """Seeder under test wired to the real services."""
        return DemoPlanSeeder(plan_service, asset_service)

    async def test_seed_if_empty__when_store_is_empty__installs_the_demo_plan(
        self, seeder: DemoPlanSeeder, plan_service: PlanService, asset_service: AssetService
    ) -> None:
        """First run creates the named demo plan, wires the underlay to the uploaded photo asset."""
        seeded = await seeder.seed_if_empty()

        assert seeded is True
        summaries = await plan_service.list_plans()
        assert len(summaries) == 1
        assert summaries[0].name == "Sous-sol (démo)"

        plan = await plan_service.get_plan(summaries[0].id)
        assert plan.revision == 2
        assert len(plan.document.circuits) == 9
        assert plan.document.underlay is not None
        image_ref = plan.document.underlay.image_ref
        assert image_ref != "__DEMO_ASSET__"

        asset_path = await asset_service.resolve_file(image_ref)
        assert asset_path.is_file()

    async def test_seed_if_empty__when_a_plan_already_exists__skips_without_side_effects(
        self,
        seeder: DemoPlanSeeder,
        plan_service: PlanService,
        tmp_path: Path,
    ) -> None:
        """A pre-existing plan (archived or not) suppresses seeding and uploads no asset."""
        await plan_service.create_plan("Existing")

        seeded = await seeder.seed_if_empty()

        assert seeded is False
        summaries = await plan_service.list_plans()
        assert [summary.name for summary in summaries] == ["Existing"]
        assert list((tmp_path / "data" / "assets").iterdir()) == []

    async def test_seed_if_empty__when_demo_document_is_missing__logs_and_returns_false(
        self,
        seeder: DemoPlanSeeder,
        plan_service: PlanService,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A broken demo package is swallowed: no plan is created and startup can proceed."""
        monkeypatch.setattr(demo_plan_seeder, "DEMO_DOCUMENT_FILE", "does-not-exist.json")

        seeded = await seeder.seed_if_empty()

        assert seeded is False
        assert await plan_service.list_plans() == []
