"""Business logic for asset uploads and retrieval."""

from pathlib import Path

from loguru import logger

from backend.constants import ASSET_EXTENSIONS_BY_CONTENT_TYPE
from backend.core.errors import (
    AssetNotFoundError,
    AssetTooLargeError,
    UnsupportedAssetTypeError,
)
from backend.interfaces.asset_repository import AssetRepository
from backend.models.asset import Asset
from backend.settings import AppSettings


class AssetService:
    """Business logic for binary assets (underlay images).

    Role:
        Validates uploads (whitelisted image content types, configured size
        limit) before delegating storage to the injected repository, and
        resolves stored assets for serving. Assets are immutable: uploaded
        once, never modified.
    """

    def __init__(self, repo: AssetRepository, settings: AppSettings) -> None:
        """Store the persistence and configuration dependencies.

        Args:
            repo: Asset persistence port used for all storage operations.
            settings: Application settings providing the maximum accepted
                asset size.
        """
        self._repo = repo
        self._max_size_bytes = settings.max_asset_size_bytes

    async def upload(self, content: bytes, content_type: str) -> Asset:
        """Validate and store a new asset.

        Args:
            content: Raw bytes of the uploaded file.
            content_type: Declared content type of the upload.

        Returns:
            The metadata of the stored asset.

        Raises:
            UnsupportedAssetTypeError: When the content type is not a
                whitelisted image type.
            AssetTooLargeError: When the content exceeds the configured
                size limit.
        """
        if content_type not in ASSET_EXTENSIONS_BY_CONTENT_TYPE:
            raise UnsupportedAssetTypeError(content_type, sorted(ASSET_EXTENSIONS_BY_CONTENT_TYPE))
        if len(content) > self._max_size_bytes:
            raise AssetTooLargeError(len(content), self._max_size_bytes)
        asset = await self._repo.save(content, content_type)
        logger.info(
            "Stored asset {} ({}, {} bytes)", asset.id, asset.content_type, asset.size_bytes
        )
        return asset

    async def get_meta(self, asset_id: str) -> Asset:
        """Fetch an asset's metadata.

        Args:
            asset_id: Identifier of the asset to look up.

        Returns:
            The asset metadata.

        Raises:
            AssetNotFoundError: When no asset has this id.
        """
        meta = await self._repo.get_meta(asset_id)
        if meta is None:
            raise AssetNotFoundError(asset_id)
        return meta

    async def resolve_file(self, asset_id: str) -> Path:
        """Resolve the filesystem path of a stored asset for serving.

        Args:
            asset_id: Identifier of the asset to resolve.

        Returns:
            The path to the stored file.

        Raises:
            AssetNotFoundError: When the asset is unknown or its file is
                missing on disk.
        """
        path = await self._repo.open_path(asset_id)
        if path is None:
            raise AssetNotFoundError(asset_id)
        return path
