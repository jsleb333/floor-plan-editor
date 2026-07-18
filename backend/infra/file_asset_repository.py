"""Filesystem + SQLite adapter for asset persistence."""

from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import aiosqlite

from backend.constants import ASSET_EXTENSIONS_BY_CONTENT_TYPE
from backend.core.errors import UnsupportedAssetTypeError
from backend.interfaces.asset_repository import AssetRepository
from backend.models.asset import Asset


ASSETS_SUBDIRECTORY = "assets"

CREATE_ASSETS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL
)
"""

INSERT_ASSET_SQL = """
INSERT INTO assets (id, content_type, size_bytes, created_at)
VALUES (?, ?, ?, ?)
"""

SELECT_ASSET_SQL = """
SELECT id, content_type, size_bytes, created_at FROM assets WHERE id = ?
"""


class FileAssetRepository(AssetRepository):
    """Filesystem implementation of the asset persistence port.

    Role:
        Stores asset bytes as immutable files under ``<data_dir>/assets``
        (named by a fresh uuid plus the extension matching their content
        type) and their metadata in the ``assets`` SQLite table, sharing the
        application database connection. Files are written once and never
        mutated.
    """

    def __init__(self, connection: aiosqlite.Connection, data_dir: Path) -> None:
        """Wrap the shared database connection and the data directory.

        Args:
            connection: Open aiosqlite connection to the application
                database; the repository never opens or closes it (the
                container owns its lifecycle).
            data_dir: Root data directory; asset files live in its
                ``assets`` subdirectory.
        """
        self._connection = connection
        self._assets_dir = data_dir / ASSETS_SUBDIRECTORY

    async def initialize(self) -> None:
        """Create the assets table and the assets directory if missing."""
        await self._connection.execute(CREATE_ASSETS_TABLE_SQL)
        await self._connection.commit()
        self._assets_dir.mkdir(parents=True, exist_ok=True)

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
        extension = ASSET_EXTENSIONS_BY_CONTENT_TYPE.get(content_type)
        if extension is None:
            raise UnsupportedAssetTypeError(content_type, sorted(ASSET_EXTENSIONS_BY_CONTENT_TYPE))
        asset = Asset(
            id=uuid4().hex,
            content_type=content_type,
            size_bytes=len(content),
            created_at=datetime.now(UTC),
        )
        (self._assets_dir / f"{asset.id}{extension}").write_bytes(content)
        await self._connection.execute(
            INSERT_ASSET_SQL,
            (asset.id, asset.content_type, asset.size_bytes, asset.created_at.isoformat()),
        )
        await self._connection.commit()
        return asset

    async def get_meta(self, asset_id: str) -> Asset | None:
        """Fetch an asset's metadata.

        Args:
            asset_id: Identifier of the asset to look up.

        Returns:
            The asset metadata, or None when no asset has this id.
        """
        cursor = await self._connection.execute(SELECT_ASSET_SQL, (asset_id,))
        row = await cursor.fetchone()
        if row is None:
            return None
        return Asset(
            id=row[0],
            content_type=row[1],
            size_bytes=row[2],
            created_at=datetime.fromisoformat(row[3]),
        )

    async def open_path(self, asset_id: str) -> Path | None:
        """Resolve the filesystem path of a stored asset for serving.

        Args:
            asset_id: Identifier of the asset to resolve.

        Returns:
            The path to the stored file, or None when the asset is unknown
            or its file is missing on disk.
        """
        meta = await self.get_meta(asset_id)
        if meta is None:
            return None
        path = self._assets_dir / f"{meta.id}{ASSET_EXTENSIONS_BY_CONTENT_TYPE[meta.content_type]}"
        if not path.is_file():
            return None
        return path
