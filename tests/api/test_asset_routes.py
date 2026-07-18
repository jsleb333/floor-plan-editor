"""End-to-end tests of the assets API over the real app and temporary storage."""

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from backend.main import create_app
from httpx import ASGITransport, AsyncClient


MAX_SIZE_BYTES = 1024
JPEG_BYTES = b"\xff\xd8\xff\xe0fake-jpeg-content"


class TestAssetRoutes:
    @pytest.fixture
    async def client(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> AsyncIterator[AsyncClient]:
        """HTTP client on the full app, storing database and assets under a temporary directory."""
        monkeypatch.setenv("FLOORPLAN_DB_PATH", str(tmp_path / "test.db"))
        monkeypatch.setenv("FLOORPLAN_DATA_DIR", str(tmp_path / "data"))
        monkeypatch.setenv("FLOORPLAN_MAX_ASSET_SIZE_BYTES", str(MAX_SIZE_BYTES))
        app = create_app()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client
        await app.state.dishka_container.close()

    async def test_asset_upload_flow__when_jpeg_is_uploaded__serves_identical_bytes(
        self, client: AsyncClient
    ) -> None:
        """A multipart jpeg upload returns 201 with metadata; GET streams the same bytes with the right content type and immutable caching."""
        uploaded = await client.post(
            "/api/assets",
            files={"file": ("plan.jpg", JPEG_BYTES, "image/jpeg")},
        )

        assert uploaded.status_code == 201
        asset = uploaded.json()
        assert asset["content_type"] == "image/jpeg"
        assert asset["size_bytes"] == len(JPEG_BYTES)

        fetched = await client.get(f"/api/assets/{asset['id']}")
        assert fetched.status_code == 200
        assert fetched.content == JPEG_BYTES
        assert fetched.headers["content-type"] == "image/jpeg"
        assert fetched.headers["cache-control"] == "public, max-age=31536000, immutable"

    async def test_upload_asset__when_content_exceeds_size_limit__returns_413(
        self, client: AsyncClient
    ) -> None:
        response = await client.post(
            "/api/assets",
            files={"file": ("plan.png", b"\x89" * (MAX_SIZE_BYTES + 1), "image/png")},
        )

        assert response.status_code == 413

    async def test_upload_asset__when_content_type_is_not_whitelisted__returns_415(
        self, client: AsyncClient
    ) -> None:
        response = await client.post(
            "/api/assets",
            files={"file": ("notes.txt", b"plain text", "text/plain")},
        )

        assert response.status_code == 415

    async def test_get_asset__when_id_is_unknown__returns_404(self, client: AsyncClient) -> None:
        response = await client.get("/api/assets/unknown-id")

        assert response.status_code == 404
        assert "unknown-id" in response.json()["detail"]
