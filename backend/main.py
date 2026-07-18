"""FastAPI application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from dishka import AsyncContainer, make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from backend.api.asset_routes import router as asset_router
from backend.api.routes import router
from backend.container import AppProvider
from backend.core.errors import (
    AssetNotFoundError,
    AssetTooLargeError,
    PlanNotArchivedError,
    PlanNotFoundError,
    RevisionConflictError,
    UnsupportedAssetTypeError,
)
from backend.core.orchestrators.demo_plan_seeder import DemoPlanSeeder
from backend.settings import AppSettings


API_PATH_PREFIX = "api"


def _not_found_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Map domain not-found errors to a 404 response."""
    return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content={"detail": str(exc)})


def _conflict_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Map domain conflict errors to a 409 response."""
    return JSONResponse(status_code=status.HTTP_409_CONFLICT, content={"detail": str(exc)})


def _payload_too_large_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Map oversized upload errors to a 413 response."""
    return JSONResponse(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, content={"detail": str(exc)}
    )


def _unsupported_media_type_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Map unsupported asset type errors to a 415 response."""
    return JSONResponse(
        status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, content={"detail": str(exc)}
    )


async def _seed_demo_plan(container: AsyncContainer) -> None:
    """Install the bundled demo plan on first run when seeding is enabled.

    Args:
        container: Application container used to resolve the settings and the
            demo seeding orchestrator.
    """
    settings = await container.get(AppSettings)
    if not settings.seed_demo_plan:
        return
    seeder = await container.get(DemoPlanSeeder)
    await seeder.seed_if_empty()


def create_app() -> FastAPI:
    """Build the FastAPI application with its container, routes and SPA hosting.

    Returns:
        The fully configured application.
    """
    container = make_async_container(AppProvider())

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        """Seed the demo plan on first run, then close the container on shutdown."""
        await _seed_demo_plan(container)
        try:
            yield
        finally:
            await app.state.dishka_container.close()

    app = FastAPI(title="Floor Plan Editor", lifespan=lifespan)
    app.include_router(router, prefix=f"/{API_PATH_PREFIX}")
    app.include_router(asset_router, prefix=f"/{API_PATH_PREFIX}")
    app.add_exception_handler(PlanNotFoundError, _not_found_handler)
    app.add_exception_handler(AssetNotFoundError, _not_found_handler)
    app.add_exception_handler(RevisionConflictError, _conflict_handler)
    app.add_exception_handler(PlanNotArchivedError, _conflict_handler)
    app.add_exception_handler(AssetTooLargeError, _payload_too_large_handler)
    app.add_exception_handler(UnsupportedAssetTypeError, _unsupported_media_type_handler)
    setup_dishka(container, app)

    settings = AppSettings()
    if settings.frontend_dist.exists():
        _mount_spa(app, settings)
    else:
        logger.debug("Frontend dist {} not found; serving API only", settings.frontend_dist)

    return app


def _mount_spa(app: FastAPI, settings: AppSettings) -> None:
    """Serve the built SPA: static assets plus an index.html fallback.

    Args:
        app: Application to mount the SPA routes on.
        settings: Application settings providing the frontend dist path.
    """
    assets_dir = settings.frontend_dist / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    index_html = settings.frontend_dist / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str) -> FileResponse:
        """Serve the SPA entry point for any non-API path."""
        if full_path == API_PATH_PREFIX or full_path.startswith(f"{API_PATH_PREFIX}/"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
        return FileResponse(index_html)


app = create_app()
