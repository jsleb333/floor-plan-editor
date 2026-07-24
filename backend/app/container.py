"""Dependency injection wiring."""

from collections.abc import AsyncIterator

import aiosqlite
from dishka import Provider, Scope, provide

from backend.app.demo_plan_seeder import DemoPlanSeeder
from backend.app.settings import AppSettings
from backend.core.device_load_resolver import DeviceLoadResolver
from backend.core.plan_migrator import PlanMigrator
from backend.core.services.asset_service import AssetService, MaxAssetSizeBytes
from backend.core.services.circuit_validation_service import CircuitValidationService
from backend.core.services.plan_service import PlanService
from backend.infra.file_asset_repository import FileAssetRepository
from backend.infra.sqlite_plan_repository import SqlitePlanRepository
from backend.interfaces.asset_repository import AssetRepository
from backend.interfaces.plan_repository import PlanRepository


class AppProvider(Provider):
    """Wires infrastructure adapters into services.

    Role:
        Single composition root of the backend: loads the configuration,
        owns the database connection lifecycle, binds repository
        implementations to their ports, and hands core components the
        narrow configuration values they declare — core never sees the
        settings object itself.
    """

    scope = Scope.APP

    @provide
    def get_settings(self) -> AppSettings:
        """Load the application settings from environment variables."""
        return AppSettings()

    @provide
    def get_max_asset_size(self, settings: AppSettings) -> MaxAssetSizeBytes:
        """Extract the upload size limit for injection into the asset service.

        Args:
            settings: Application settings providing the configured limit.

        Returns:
            The maximum accepted asset size in bytes.
        """
        return MaxAssetSizeBytes(settings.max_asset_size_bytes)

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
