"""Port for asset persistence."""

from abc import ABC, abstractmethod
from pathlib import Path

from backend.models.asset import Asset


class AssetRepository(ABC):
    """Persistence port for binary assets (underlay images).

    Role:
        Contract every asset storage adapter must fulfil: store immutable
        binary content with its metadata, and hand back the metadata or a
        filesystem path for serving. Services depend on this interface only;
        concrete adapters live in ``backend/infra``.
    """

    @abstractmethod
    async def save(self, content: bytes, content_type: str) -> Asset:
        """Store new asset content under a fresh identifier.

        Args:
            content: Raw bytes of the asset.
            content_type: Declared content type of the asset; must be one of
                the whitelisted image types.

        Returns:
            The metadata of the stored asset.

        Raises:
            UnsupportedAssetTypeError: When the content type is not
                whitelisted.
        """

    @abstractmethod
    async def get_meta(self, asset_id: str) -> Asset | None:
        """Fetch an asset's metadata.

        Args:
            asset_id: Identifier of the asset to look up.

        Returns:
            The asset metadata, or None when no asset has this id.
        """

    @abstractmethod
    async def open_path(self, asset_id: str) -> Path | None:
        """Resolve the filesystem path of a stored asset for serving.

        Args:
            asset_id: Identifier of the asset to resolve.

        Returns:
            The path to the stored file, or None when the asset is unknown
            or its file is missing on disk.
        """
