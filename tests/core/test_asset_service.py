"""Tests for AssetService validation rules over a mocked repository."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from backend.core.asset_service import AssetService
from backend.core.errors import (
    AssetNotFoundError,
    AssetTooLargeError,
    UnsupportedAssetTypeError,
)
from backend.interfaces.asset_repository import AssetRepository
from backend.models.asset import Asset
from backend.settings import AppSettings


MAX_SIZE_BYTES = 64


class TestAssetService:
    @pytest.fixture
    def repo(self) -> AssetRepository:
        """Repository mock honouring the AssetRepository port."""
        return AsyncMock(spec=AssetRepository)

    @pytest.fixture
    def service(self, repo: AssetRepository) -> AssetService:
        """Service under test with a small configured size limit."""
        return AssetService(repo, AppSettings(max_asset_size_bytes=MAX_SIZE_BYTES))

    async def test_upload__when_content_is_valid__stores_and_returns_asset(
        self, service: AssetService, repo: AssetRepository
    ) -> None:
        """A whitelisted type under the size limit is delegated to the repository as-is."""
        stored = Asset(
            id="abc123",
            content_type="image/png",
            size_bytes=8,
            created_at=datetime(2026, 7, 1, tzinfo=UTC),
        )
        repo.save.return_value = stored

        asset = await service.upload(b"\x89PNG....", "image/png")

        assert asset == stored
        repo.save.assert_awaited_once_with(b"\x89PNG....", "image/png")

    async def test_upload__when_content_type_is_not_whitelisted__raises_unsupported_type(
        self, service: AssetService, repo: AssetRepository
    ) -> None:
        """Nothing reaches storage when the content type is refused."""
        with pytest.raises(UnsupportedAssetTypeError):
            await service.upload(b"plain text", "text/plain")

        repo.save.assert_not_awaited()

    async def test_upload__when_content_exceeds_size_limit__raises_too_large(
        self, service: AssetService, repo: AssetRepository
    ) -> None:
        """Nothing reaches storage when the upload is oversized."""
        with pytest.raises(AssetTooLargeError):
            await service.upload(b"x" * (MAX_SIZE_BYTES + 1), "image/jpeg")

        repo.save.assert_not_awaited()

    async def test_get_meta__when_id_is_unknown__raises_asset_not_found(
        self, service: AssetService, repo: AssetRepository
    ) -> None:
        repo.get_meta.return_value = None

        with pytest.raises(AssetNotFoundError):
            await service.get_meta("missing")

    async def test_resolve_file__when_id_is_unknown__raises_asset_not_found(
        self, service: AssetService, repo: AssetRepository
    ) -> None:
        repo.open_path.return_value = None

        with pytest.raises(AssetNotFoundError):
            await service.resolve_file("missing")
