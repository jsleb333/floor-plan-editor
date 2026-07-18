"""Tests for FileAssetRepository over a real temporary directory and database."""

from collections.abc import AsyncIterator
from pathlib import Path

import aiosqlite
import pytest
from backend.core.errors import UnsupportedAssetTypeError
from backend.infra.file_asset_repository import FileAssetRepository


JPEG_BYTES = b"\xff\xd8\xff\xe0fake-jpeg-content"
PNG_BYTES = b"\x89PNG\r\n\x1a\nfake-png-content"


class TestFileAssetRepository:
    @pytest.fixture
    async def connection(self, tmp_path: Path) -> AsyncIterator[aiosqlite.Connection]:
        """Open aiosqlite connection to a fresh database file, closed after the test."""
        connection = await aiosqlite.connect(tmp_path / "test.db")
        yield connection
        await connection.close()

    @pytest.fixture
    async def repository(
        self, connection: aiosqlite.Connection, tmp_path: Path
    ) -> FileAssetRepository:
        """Repository under test, initialized on a temporary data directory."""
        repository = FileAssetRepository(connection, tmp_path / "data")
        await repository.initialize()
        return repository

    async def test_save__when_content_is_jpeg__writes_file_and_metadata_row(
        self, repository: FileAssetRepository, tmp_path: Path
    ) -> None:
        """Saving stores the bytes under assets/<id>.jpg and the metadata is retrievable through get_meta."""
        asset = await repository.save(JPEG_BYTES, "image/jpeg")

        stored_file = tmp_path / "data" / "assets" / f"{asset.id}.jpg"
        assert stored_file.read_bytes() == JPEG_BYTES
        assert asset.content_type == "image/jpeg"
        assert asset.size_bytes == len(JPEG_BYTES)
        assert await repository.get_meta(asset.id) == asset

    async def test_save__when_content_is_png__uses_png_extension(
        self, repository: FileAssetRepository, tmp_path: Path
    ) -> None:
        asset = await repository.save(PNG_BYTES, "image/png")

        assert (tmp_path / "data" / "assets" / f"{asset.id}.png").is_file()

    async def test_save__when_content_type_is_not_whitelisted__raises_unsupported_type(
        self, repository: FileAssetRepository, tmp_path: Path
    ) -> None:
        """Non-image content types are refused and nothing is written to disk."""
        with pytest.raises(UnsupportedAssetTypeError):
            await repository.save(b"plain text", "text/plain")

        assert list((tmp_path / "data" / "assets").iterdir()) == []

    async def test_open_path__when_asset_exists__returns_path_to_stored_bytes(
        self, repository: FileAssetRepository
    ) -> None:
        asset = await repository.save(JPEG_BYTES, "image/jpeg")

        path = await repository.open_path(asset.id)

        assert path is not None
        assert path.read_bytes() == JPEG_BYTES

    async def test_get_meta__when_id_is_unknown__returns_none(
        self, repository: FileAssetRepository
    ) -> None:
        assert await repository.get_meta("unknown-id") is None

    async def test_open_path__when_id_is_unknown__returns_none(
        self, repository: FileAssetRepository
    ) -> None:
        assert await repository.open_path("unknown-id") is None
