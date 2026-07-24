"""Maps domain exceptions to HTTP error responses."""

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from backend.core.errors import (
    AssetNotFoundError,
    AssetTooLargeError,
    PlanNotArchivedError,
    PlanNotFoundError,
    RevisionConflictError,
    UnsupportedAssetTypeError,
)


def register_error_handlers(app: FastAPI) -> None:
    """Attach the domain-exception-to-HTTP mappings to the application.

    Args:
        app: Application to register the exception handlers on.
    """
    app.add_exception_handler(PlanNotFoundError, _not_found_handler)
    app.add_exception_handler(AssetNotFoundError, _not_found_handler)
    app.add_exception_handler(RevisionConflictError, _conflict_handler)
    app.add_exception_handler(PlanNotArchivedError, _conflict_handler)
    app.add_exception_handler(AssetTooLargeError, _payload_too_large_handler)
    app.add_exception_handler(UnsupportedAssetTypeError, _unsupported_media_type_handler)


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
