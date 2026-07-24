"""End-to-end test that the app lifespan seeds the demo plan on a fresh install."""

from pathlib import Path

import pytest
from backend.app.main import create_app
from httpx import ASGITransport, AsyncClient


class TestDemoSeedOnStartup:
    async def test_lifespan__when_database_is_empty__seeds_the_demo_plan(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Running the app lifespan against an empty temporary store publishes the demo plan through the API."""
        monkeypatch.setenv("FLOORPLAN_DB_PATH", str(tmp_path / "test.db"))
        monkeypatch.setenv("FLOORPLAN_DATA_DIR", str(tmp_path / "data"))
        app = create_app()
        transport = ASGITransport(app=app)

        async with (
            app.router.lifespan_context(app),
            AsyncClient(transport=transport, base_url="http://test") as client,
        ):
            response = await client.get("/api/plans")

        assert response.status_code == 200
        plans = response.json()
        assert len(plans) == 1
        assert plans[0]["name"] == "Sous-sol (démo)"
