"""Dependency injection wiring."""

from collections.abc import AsyncIterator

import aiosqlite
from dishka import Provider, Scope, provide

from backend.core.device_load_resolver import DeviceLoadResolver
from backend.core.orchestrators.demo_plan_seeder import DemoPlanSeeder
from backend.core.plan_migrator import PlanMigrator
from backend.core.services.asset_service import AssetService
from backend.core.services.circuit_validation_service import CircuitValidationService
from backend.core.services.plan_service import PlanService
from backend.infra.file_asset_repository import FileAssetRepository
from backend.infra.sqlite_plan_repository import SqlitePlanRepository
from backend.interfaces.asset_repository import AssetRepository
from backend.interfaces.plan_repository import PlanRepository
from backend.settings import AppSettings


class AppProvider(Provider):
    """Wires infrastructure adapters into services.

    Role:
        Single composition root of the backend: loads the configuration,
        owns the database connection lifecycle, and binds repository
        implementations to their ports for injection into services.
    """

    scope = Scope.APP

    @provide
    def get_settings(self) -> AppSettings:
        """Load the application settings from environment variables."""
        return AppSettings()

    @provide
    async def get_connection(self, settings: AppSettings) -> AsyncIterator[aiosqlite.Connection]:
        """Open the SQLite database connection for the lifetime of the app.

        Args:
            settings: Application settings providing the database path.

        Yields:
            An open aiosqlite connection, closed on container teardown.
        """
        settings.db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = await aiosqlite.connect(settings.db_path)
        yield connection
        await connection.close()

    @provide
    async def get_plan_repository(self, connection: aiosqlite.Connection) -> PlanRepository:
        """Build the SQLite plan repository and ensure its schema exists.

        Args:
            connection: Open database connection owned by the container.

        Returns:
            An initialized repository bound to the plan persistence port.
        """
        repository = SqlitePlanRepository(connection)
        await repository.initialize()
        return repository

    @provide
    async def get_asset_repository(
        self, connection: aiosqlite.Connection, settings: AppSettings
    ) -> AssetRepository:
        """Build the file asset repository and ensure its schema and directory exist.

        Args:
            connection: Open database connection owned by the container.
            settings: Application settings providing the data directory.

        Returns:
            An initialized repository bound to the asset persistence port.
        """
        repository = FileAssetRepository(connection, settings.data_dir)
        await repository.initialize()
        return repository

    plan_migrator = provide(PlanMigrator)
    device_load_resolver = provide(DeviceLoadResolver)
    plan_service = provide(PlanService)
    asset_service = provide(AssetService)
    circuit_validation_service = provide(CircuitValidationService)
    demo_plan_seeder = provide(DemoPlanSeeder)
