"""HTTP routes for asset upload and serving."""

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, UploadFile, status
from fastapi.responses import FileResponse

from backend.core.services.asset_service import AssetService
from backend.models.asset import Asset


IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"

router = APIRouter(route_class=DishkaRoute, tags=["assets"])


@router.post("/assets", status_code=status.HTTP_201_CREATED)
async def upload_asset(file: UploadFile, service: FromDishka[AssetService]) -> Asset:
    """Upload an underlay image (multipart field ``file``)."""
    content = await file.read()
    return await service.upload(content, file.content_type or "")


@router.get("/assets/{asset_id}")
async def get_asset(asset_id: str, service: FromDishka[AssetService]) -> FileResponse:
    """Serve a stored asset file; assets are immutable, so caching is aggressive."""
    meta = await service.get_meta(asset_id)
    path = await service.resolve_file(asset_id)
    return FileResponse(
        path,
        media_type=meta.content_type,
        headers={"Cache-Control": IMMUTABLE_CACHE_CONTROL},
    )
