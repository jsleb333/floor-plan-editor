"""End-to-end tests of the plans API over the real app and a temporary database."""

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from backend.app.main import create_app
from httpx import ASGITransport, AsyncClient


class TestPlanRoutes:
    @pytest.fixture
    async def client(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> AsyncIterator[AsyncClient]:
        """HTTP client on the full app, persisting to a temporary database file."""
        monkeypatch.setenv("FLOORPLAN_DB_PATH", str(tmp_path / "test.db"))
        monkeypatch.setenv("FLOORPLAN_DATA_DIR", str(tmp_path / "data"))
        app = create_app()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client
        await app.state.dishka_container.close()

    async def _create_plan(self, client: AsyncClient, name: str = "Basement") -> dict:
        """Create a plan through the API and return its JSON body."""
        response = await client.post("/api/plans", json={"name": name})
        assert response.status_code == 201
        return response.json()

    async def test_plan_crud_flow__when_used_end_to_end__persists_every_step(
        self, client: AsyncClient
    ) -> None:
        """Create, list, fetch and autosave a plan; the revision bumps and the document sticks."""
        created = await self._create_plan(client, "Basement")
        assert created["name"] == "Basement"
        assert not created["description"]
        assert created["revision"] == 1
        assert created["document"]["schema_version"] == 7
        assert created["document"]["underlay"] is None
        assert created["document"]["walls"] == []
        assert created["document"]["devices"] == []
        assert created["document"]["catalog_defaults"] == {}
        assert created["document"]["thickness_presets_in"] == [12.0, 4.5, 3.5]
        assert created["document"]["display_precision_in"] is None
        assert created["document"]["circuits"] == []
        assert created["document"]["wires"] == []
        assert created["document"]["control_links"] == []
        assert created["document"]["active_tool"] is None

        listed = (await client.get("/api/plans")).json()
        assert [summary["id"] for summary in listed] == [created["id"]]
        assert listed[0]["name"] == "Basement"
        assert not listed[0]["description"]

        fetched = (await client.get(f"/api/plans/{created['id']}")).json()
        assert fetched == created

        new_document = dict(created["document"])
        new_document["viewport"] = {"center": {"x": 24.0, "y": -12.0}, "zoom": 2.0}
        updated = await client.put(
            f"/api/plans/{created['id']}",
            json={"revision": 1, "document": new_document},
        )
        assert updated.status_code == 200
        assert updated.json() == {"revision": 2}

        refetched = (await client.get(f"/api/plans/{created['id']}")).json()
        assert refetched["revision"] == 2
        assert refetched["document"] == new_document

    async def test_update_plan_document__when_document_has_structure_elements__roundtrips(
        self, client: AsyncClient
    ) -> None:
        """A full v7 document with an underlay and one of each structure element survives a PUT/GET roundtrip byte for byte."""
        created = await self._create_plan(client, "Basement")
        document = {
            "schema_version": 7,
            "viewport": {"center": {"x": 120.0, "y": 90.0}, "zoom": 1.5},
            "underlay": {
                "image_ref": "abc123",
                "transform": {
                    "origin": {"x": -24.0, "y": -36.0},
                    "rotation_deg": 1.5,
                    "scale": 0.4,
                },
                "opacity": 0.55,
                "locked": True,
                "visible": True,
            },
            "walls": [
                {
                    "id": "wall-exterior",
                    "vertices": [
                        {"x": 0.0, "y": 0.0},
                        {"x": 240.0, "y": 0.0},
                        {"x": 240.0, "y": 180.0},
                        {"x": 0.0, "y": 180.0},
                    ],
                    "thickness_in": 12.0,
                    "reference": "left",
                    "closed": True,
                    "locked_segments": [0, 2],
                    "junctions": [],
                },
                {
                    "id": "wall-partition",
                    "vertices": [{"x": 96.0, "y": 0.0}, {"x": 96.0, "y": 180.0}],
                    "thickness_in": 3.5,
                    "reference": "center",
                    "closed": False,
                    "locked_segments": [],
                    "junctions": [
                        {
                            "end": "start",
                            "host_wall_id": "wall-exterior",
                            "segment_index": 0,
                            "t": 96.0,
                        },
                        {
                            "end": "end",
                            "host_wall_id": "wall-exterior",
                            "segment_index": 2,
                            "t": 144.0,
                        },
                    ],
                },
            ],
            "openings": [
                {
                    "id": "door-1",
                    "kind": "door",
                    "wall_id": "wall-partition",
                    "segment_index": 0,
                    "t": 48.0,
                    "width_in": 32.0,
                    "hinge": "right",
                    "swing": "out",
                }
            ],
            "stairs": [
                {
                    "id": "stairs-1",
                    "origin": {"x": 200.0, "y": 20.0},
                    "width_in": 36.0,
                    "length_in": 120.0,
                    "rotation_deg": 90.0,
                    "direction": "down",
                }
            ],
            "labels": [
                {
                    "id": "label-1",
                    "position": {"x": 48.0, "y": 90.0},
                    "text": "Bedroom",
                    "size_in": 10.0,
                }
            ],
            "dimensions": [
                {
                    "id": "dim-1",
                    "p1": {"x": 0.0, "y": 0.0},
                    "p2": {"x": 240.0, "y": 0.0},
                    "offset_in": 18.0,
                }
            ],
            "devices": [],
            "catalog_defaults": {},
            "thickness_presets_in": [12.0, 4.5, 3.5, 5.5],
            "display_precision_in": 0.125,
            "circuits": [],
            "wires": [],
            "control_links": [],
            "active_tool": "wall",
        }

        updated = await client.put(
            f"/api/plans/{created['id']}",
            json={"revision": 1, "document": document},
        )
        assert updated.status_code == 200

        refetched = (await client.get(f"/api/plans/{created['id']}")).json()
        assert refetched["revision"] == 2
        assert refetched["document"] == document

    async def test_update_plan_document__when_body_is_v2_shaped__stores_it_normalized_to_v7(
        self, client: AsyncClient
    ) -> None:
        """A PUT from an older client (schema_version 2, no underlay key) still validates; the stored document claims the current schema version with an empty underlay, so no read-time migration is needed."""
        created = await self._create_plan(client, "Basement")
        v2_document = {
            "schema_version": 2,
            "viewport": {"center": {"x": 24.0, "y": -12.0}, "zoom": 2.0},
            "walls": [],
            "openings": [],
            "stairs": [],
            "labels": [],
            "dimensions": [],
            "thickness_presets_in": [12.0, 4.5, 3.5],
        }

        updated = await client.put(
            f"/api/plans/{created['id']}",
            json={"revision": 1, "document": v2_document},
        )
        assert updated.status_code == 200

        refetched = (await client.get(f"/api/plans/{created['id']}")).json()
        assert refetched["revision"] == 2
        assert refetched["document"]["schema_version"] == 7
        assert refetched["document"]["underlay"] is None
        assert refetched["document"]["devices"] == []
        assert refetched["document"]["circuits"] == []
        assert refetched["document"]["wires"] == []
        assert refetched["document"]["control_links"] == []
        assert refetched["document"]["active_tool"] is None
        assert refetched["document"]["display_precision_in"] is None
        assert refetched["document"]["viewport"] == v2_document["viewport"]

    async def test_update_plan_document__when_document_has_devices__roundtrips_them(
        self, client: AsyncClient
    ) -> None:
        """A wall-attached outlet, a positioned ceiling light and a baseboard with a length and load override survive a PUT/GET roundtrip intact at the current schema version."""
        created = await self._create_plan(client, "Basement")
        document = dict(created["document"])
        document["walls"] = [
            {
                "id": "wall-1",
                "vertices": [{"x": 0.0, "y": 0.0}, {"x": 240.0, "y": 0.0}],
                "thickness_in": 3.5,
                "reference": "center",
                "closed": False,
                "locked_segments": [],
                "junctions": [],
            }
        ]
        document["devices"] = [
            {
                "id": "outlet-1",
                "type": "outlet",
                "attachment": {"wall_id": "wall-1", "segment_index": 0, "t": 18.0, "side": "left"},
                "position": None,
                "rotation_deg": 0.0,
                "label": None,
                "load_w": None,
                "length_in": None,
                "notes": None,
            },
            {
                "id": "light-1",
                "type": "ceiling_light",
                "attachment": None,
                "position": {"x": 120.0, "y": 90.0},
                "rotation_deg": 0.0,
                "label": "Salon",
                "load_w": None,
                "length_in": None,
                "notes": None,
            },
            {
                "id": "baseboard-1",
                "type": "baseboard_heater",
                "attachment": {
                    "wall_id": "wall-1",
                    "segment_index": 0,
                    "t": 96.0,
                    "side": "right",
                },
                "position": None,
                "rotation_deg": 0.0,
                "label": None,
                "load_w": 750.0,
                "length_in": 48.0,
                "notes": "sous la fenêtre",
            },
        ]
        document["catalog_defaults"] = {"baseboard_heater": 750.0}

        updated = await client.put(
            f"/api/plans/{created['id']}",
            json={"revision": 1, "document": document},
        )
        assert updated.status_code == 200

        refetched = (await client.get(f"/api/plans/{created['id']}")).json()
        assert refetched["revision"] == 2
        assert refetched["document"] == document
        assert refetched["document"]["schema_version"] == 7

    async def test_update_plan_document__when_device_placement_is_invalid__returns_422(
        self, client: AsyncClient
    ) -> None:
        """A ceiling-mounted device with a wall attachment is rejected by validation."""
        created = await self._create_plan(client, "Basement")
        document = dict(created["document"])
        document["devices"] = [
            {
                "id": "light-1",
                "type": "ceiling_light",
                "attachment": {"wall_id": "wall-1", "segment_index": 0, "t": 18.0},
            }
        ]

        response = await client.put(
            f"/api/plans/{created['id']}",
            json={"revision": 1, "document": document},
        )

        assert response.status_code == 422

    async def test_update_plan_document__when_opening_width_is_invalid__returns_422(
        self, client: AsyncClient
    ) -> None:
        """Pydantic validation rejects documents violating field constraints."""
        created = await self._create_plan(client, "Basement")
        document = dict(created["document"])
        document["openings"] = [
            {
                "id": "door-1",
                "kind": "door",
                "wall_id": "wall-1",
                "segment_index": 0,
                "t": 10.0,
                "width_in": 0.0,
            }
        ]

        response = await client.put(
            f"/api/plans/{created['id']}",
            json={"revision": 1, "document": document},
        )

        assert response.status_code == 422

    async def test_get_plan_validation__when_panel_circuit_and_wires_set__returns_computed_loads(
        self, client: AsyncClient
    ) -> None:
        """After autosaving a panel, one power circuit and a panel->outlet->baseboard chain, the validation endpoint returns the summed load, amps, status and connectivity."""
        created = await self._create_plan(client, "Basement")
        document = dict(created["document"])
        document["walls"] = [
            {
                "id": "wall-1",
                "vertices": [{"x": 0.0, "y": 0.0}, {"x": 240.0, "y": 0.0}],
                "thickness_in": 3.5,
                "reference": "center",
                "closed": False,
                "locked_segments": [],
                "junctions": [],
            }
        ]
        document["devices"] = [
            {"id": "panel-1", "type": "panel", "position": {"x": 0.0, "y": 0.0}},
            {
                "id": "outlet-1",
                "type": "outlet",
                "attachment": {"wall_id": "wall-1", "segment_index": 0, "t": 18.0},
            },
            {
                "id": "bb-1",
                "type": "baseboard_heater",
                "attachment": {"wall_id": "wall-1", "segment_index": 0, "t": 96.0},
                "load_w": 1500.0,
            },
            {
                "id": "outlet-floating",
                "type": "outlet",
                "attachment": {"wall_id": "wall-1", "segment_index": 0, "t": 120.0},
            },
        ]
        document["circuits"] = [
            {
                "id": "circ-1",
                "name": "Prises",
                "color": "#cc0000",
                "breaker_a": 15,
                "voltage_v": 120,
                "kind": "power",
            }
        ]
        document["wires"] = [
            {
                "id": "wire-1",
                "circuit_id": "circ-1",
                "from_device_id": "panel-1",
                "to_device_id": "outlet-1",
                "control_points": [],
            },
            {
                "id": "wire-2",
                "circuit_id": "circ-1",
                "from_device_id": "outlet-1",
                "to_device_id": "bb-1",
                "control_points": [],
            },
        ]

        updated = await client.put(
            f"/api/plans/{created['id']}",
            json={"revision": 1, "document": document},
        )
        assert updated.status_code == 200

        validation = (await client.get(f"/api/plans/{created['id']}/validation")).json()

        assert validation["has_panel"] is True
        assert validation["dangling_wire_ids"] == []
        assert validation["multi_circuit_device_ids"] == {}
        assert validation["unassigned_device_ids"] == ["outlet-floating"]
        assert len(validation["circuits"]) == 1
        circuit = validation["circuits"][0]
        assert circuit["circuit_id"] == "circ-1"
        assert circuit["connected_device_ids"] == ["bb-1", "outlet-1"]
        assert circuit["floating_device_ids"] == []
        assert circuit["load_w"] == 1680.0
        assert circuit["amps"] == pytest.approx(14.0)
        assert circuit["status"] == "warning"

    async def test_get_plan_validation__when_plan_is_unknown__returns_404(
        self, client: AsyncClient
    ) -> None:
        """Validating a missing plan surfaces the not-found error as a 404."""
        response = await client.get("/api/plans/unknown-id/validation")

        assert response.status_code == 404

    async def test_create_plan__when_seeded_with_options__returns_plan_ready_for_calibration(
        self, client: AsyncClient
    ) -> None:
        """Creating with a description, an uploaded underlay photo and tier-2 defaults returns a plan whose document opens straight into calibration, and the description shows up in the listing."""
        uploaded = await client.post(
            "/api/assets",
            files={"file": ("plan.jpg", b"\xff\xd8\xff\xe0fake-jpeg", "image/jpeg")},
        )
        assert uploaded.status_code == 201
        asset_id = uploaded.json()["id"]

        response = await client.post(
            "/api/plans",
            json={
                "name": "Basement",
                "description": "Traced from the hand-drawn plan",
                "underlay_asset_id": asset_id,
                "thickness_presets_in": [10.0, 4.5],
                "display_precision_in": 0.25,
            },
        )

        assert response.status_code == 201
        created = response.json()
        assert created["description"] == "Traced from the hand-drawn plan"
        assert created["document"]["underlay"] == {
            "image_ref": asset_id,
            "transform": {"origin": {"x": 0.0, "y": 0.0}, "rotation_deg": 0.0, "scale": 1.0},
            "opacity": 0.4,
            "locked": False,
            "visible": True,
        }
        assert created["document"]["thickness_presets_in"] == [10.0, 4.5]
        assert created["document"]["display_precision_in"] == 0.25

        listed = (await client.get("/api/plans")).json()
        assert listed[0]["description"] == "Traced from the hand-drawn plan"

    async def test_create_plan__when_underlay_asset_is_unknown__returns_404_without_creating(
        self, client: AsyncClient
    ) -> None:
        """A creation referencing a non-existent asset id fails cleanly and stores nothing."""
        response = await client.post(
            "/api/plans",
            json={"name": "Basement", "underlay_asset_id": "no-such-asset"},
        )

        assert response.status_code == 404
        assert "no-such-asset" in response.json()["detail"]
        assert (await client.get("/api/plans")).json() == []

    async def test_update_plan_metadata__when_only_name_is_sent__renames_and_keeps_description(
        self, client: AsyncClient
    ) -> None:
        """The pre-description rename payload still works and does not clear the description."""
        response = await client.post(
            "/api/plans", json={"name": "Basement", "description": "the family basement"}
        )
        created = response.json()

        renamed = await client.patch(f"/api/plans/{created['id']}", json={"name": "Garage"})

        assert renamed.status_code == 200
        assert renamed.json()["name"] == "Garage"
        assert renamed.json()["description"] == "the family basement"

    async def test_update_plan_metadata__when_only_description_is_sent__keeps_name(
        self, client: AsyncClient
    ) -> None:
        created = await self._create_plan(client, "Basement")

        response = await client.patch(
            f"/api/plans/{created['id']}", json={"description": "now with a description"}
        )

        assert response.status_code == 200
        assert response.json()["name"] == "Basement"
        assert response.json()["description"] == "now with a description"

    async def test_duplicate_plan__when_plan_exists__creates_copy(
        self, client: AsyncClient
    ) -> None:
        created = await self._create_plan(client, "Basement")

        response = await client.post(f"/api/plans/{created['id']}/duplicate")

        assert response.status_code == 201
        duplicate = response.json()
        assert duplicate["id"] != created["id"]
        assert duplicate["name"] == "Basement (copy)"
        assert duplicate["document"] == created["document"]

    async def test_get_plan__when_id_is_unknown__returns_404(self, client: AsyncClient) -> None:
        response = await client.get("/api/plans/unknown-id")

        assert response.status_code == 404
        assert "unknown-id" in response.json()["detail"]

    async def test_update_plan_document__when_revision_is_stale__returns_409(
        self, client: AsyncClient
    ) -> None:
        """A second autosave with the same revision is rejected as a conflict."""
        created = await self._create_plan(client)
        body = {"revision": 1, "document": created["document"]}
        first = await client.put(f"/api/plans/{created['id']}", json=body)
        assert first.status_code == 200

        second = await client.put(f"/api/plans/{created['id']}", json=body)

        assert second.status_code == 409

    async def test_delete_plan__when_not_archived_then_archived__requires_archive_first(
        self, client: AsyncClient
    ) -> None:
        """Permanent deletion is refused until the plan is archived, then removes it."""
        created = await self._create_plan(client)

        refused = await client.delete(f"/api/plans/{created['id']}")
        assert refused.status_code == 409

        archived = await client.post(f"/api/plans/{created['id']}/archive")
        assert archived.status_code == 200
        assert archived.json()["archived_at"] is not None

        deleted = await client.delete(f"/api/plans/{created['id']}")
        assert deleted.status_code == 204

        gone = await client.get(f"/api/plans/{created['id']}")
        assert gone.status_code == 404

    async def test_restore_plan__when_plan_is_archived__clears_archived_at(
        self, client: AsyncClient
    ) -> None:
        created = await self._create_plan(client)
        await client.post(f"/api/plans/{created['id']}/archive")

        response = await client.post(f"/api/plans/{created['id']}/restore")

        assert response.status_code == 200
        assert response.json()["archived_at"] is None
