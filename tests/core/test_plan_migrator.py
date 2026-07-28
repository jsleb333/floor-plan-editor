"""Tests for PlanMigrator forward-migration of raw document dicts."""

from typing import Any

import pytest
from backend.core.errors import UnsupportedSchemaVersionError
from backend.core.plan_migrator import PlanMigrator
from backend.models.plan_document import PlanDocument


def _v1_document() -> dict[str, Any]:
    """Build a raw schema v1 document as stored by the M1 backend."""
    return {
        "schema_version": 1,
        "viewport": {"center": {"x": 24.0, "y": -12.0}, "zoom": 2.0},
    }


def _v2_document() -> dict[str, Any]:
    """Build a raw schema v2 document as stored by the M2 backend."""
    return {
        "schema_version": 2,
        "viewport": {"center": {"x": 24.0, "y": -12.0}, "zoom": 2.0},
        "walls": [],
        "openings": [],
        "stairs": [],
        "labels": [],
        "dimensions": [],
        "thickness_presets_in": [12.0, 4.5, 3.5],
    }


def _v3_document() -> dict[str, Any]:
    """Build a raw schema v3 document as stored by the M3 backend."""
    return {**_v2_document(), "schema_version": 3, "underlay": None}


def _v4_document() -> dict[str, Any]:
    """Build a raw schema v4 document as stored by the M4 backend."""
    return {**_v3_document(), "schema_version": 4, "devices": [], "catalog_defaults": {}}


def _v5_document() -> dict[str, Any]:
    """Build a raw schema v5 document as stored by the M5 backend."""
    return {
        **_v4_document(),
        "schema_version": 5,
        "circuits": [],
        "wires": [],
        "control_links": [],
    }


def _v6_document() -> dict[str, Any]:
    """Build a raw schema v6 document as stored by the pre-M8 backend."""
    return {**_v5_document(), "schema_version": 6, "active_tool": "wall"}


def _v7_document() -> dict[str, Any]:
    """Build a raw schema v7 document whose walls still carry per-wall junctions."""
    return {
        **_v6_document(),
        "schema_version": 7,
        "display_precision_in": None,
        "walls": [
            {
                "id": "host",
                "vertices": [{"x": 0.0, "y": 0.0}, {"x": 240.0, "y": 0.0}],
                "thickness_in": 12.0,
                "junctions": [],
            },
            {
                "id": "partition",
                "vertices": [{"x": 96.0, "y": 0.0}, {"x": 96.0, "y": 120.0}],
                "thickness_in": 3.5,
                "junctions": [
                    {
                        "end": "start",
                        "host_wall_id": "host",
                        "segment_index": 0,
                        "t": 96.0,
                    }
                ],
            },
        ],
    }


def _v8_document() -> dict[str, Any]:
    """Build a raw schema v8 document whose connectivity already lives in joints."""
    return {
        **_v7_document(),
        "schema_version": 8,
        "walls": [
            {
                "id": "host",
                "vertices": [{"x": 0.0, "y": 0.0}, {"x": 240.0, "y": 0.0}],
                "thickness_in": 12.0,
            },
            {
                "id": "partition",
                "vertices": [{"x": 96.0, "y": 0.0}, {"x": 96.0, "y": 120.0}],
                "thickness_in": 3.5,
            },
        ],
        "joints": [
            {
                "kind": "tee",
                "id": "joint-partition-start",
                "end": {"wall_id": "partition", "end": "start"},
                "host": {"wall_id": "host", "segment_index": 0},
            }
        ],
    }


class TestPlanMigrator:
    @pytest.fixture
    def migrator(self) -> PlanMigrator:
        """Migrator under test."""
        return PlanMigrator()

    def test_migrate__when_document_is_v1__walks_all_steps_to_v9(
        self, migrator: PlanMigrator
    ) -> None:
        """A v1 document gains the empty structure collections, the default thickness presets, the empty underlay slot, the empty device collections, the empty electrical-layout collections, the empty active-tool slot, the unset display precision and the empty joint and guide collections, while keeping its viewport; the result validates as a PlanDocument."""
        raw = _v1_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated["schema_version"] == 9
        assert migrated["viewport"] == raw["viewport"]
        assert migrated["walls"] == []
        assert migrated["openings"] == []
        assert migrated["stairs"] == []
        assert migrated["labels"] == []
        assert migrated["dimensions"] == []
        assert migrated["thickness_presets_in"] == [12.0, 4.5, 3.5]
        assert migrated["underlay"] is None
        assert migrated["devices"] == []
        assert migrated["catalog_defaults"] == {}
        assert migrated["circuits"] == []
        assert migrated["wires"] == []
        assert migrated["control_links"] == []
        assert migrated["active_tool"] is None
        assert migrated["display_precision_in"] is None
        assert migrated["joints"] == []
        assert migrated["guides"] == []
        document = PlanDocument.model_validate(migrated)
        assert document.schema_version == 9

    def test_migrate__when_document_is_v2__adds_underlay_device_and_electrical_collections(
        self, migrator: PlanMigrator
    ) -> None:
        """A v2 document gains the underlay slot, the device and electrical-layout collections, the active-tool slot, the display-precision slot, the joint and guide collections and schema version 9, keeping its structure content; the result validates as a PlanDocument."""
        raw = _v2_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated["schema_version"] == 9
        assert migrated["underlay"] is None
        assert migrated["devices"] == []
        assert migrated["catalog_defaults"] == {}
        assert migrated["circuits"] == []
        assert migrated["wires"] == []
        assert migrated["control_links"] == []
        assert migrated["active_tool"] is None
        assert migrated["display_precision_in"] is None
        assert migrated["guides"] == []
        assert migrated["viewport"] == raw["viewport"]
        assert migrated["thickness_presets_in"] == raw["thickness_presets_in"]
        document = PlanDocument.model_validate(migrated)
        assert document.underlay is None

    def test_migrate__when_document_is_v4__adds_electrical_collections_and_later_slots(
        self, migrator: PlanMigrator
    ) -> None:
        """A v4 document only gains the circuits, wires and control-link collections, the empty active-tool and display-precision slots, the empty joint and guide collections and schema version 9; the result validates as a PlanDocument."""
        raw = _v4_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated["schema_version"] == 9
        assert migrated["circuits"] == []
        assert migrated["wires"] == []
        assert migrated["control_links"] == []
        assert migrated["active_tool"] is None
        assert migrated["display_precision_in"] is None
        assert migrated["guides"] == []
        assert migrated["devices"] == []
        assert migrated["viewport"] == raw["viewport"]
        document = PlanDocument.model_validate(migrated)
        assert document.circuits == []
        assert document.wires == []
        assert document.control_links == []

    def test_migrate__when_document_is_v5__adds_the_active_tool_and_display_precision_slots(
        self, migrator: PlanMigrator
    ) -> None:
        """A v5 document gains only the empty active-tool, display-precision, joints and guides slots and schema version 9, keeping everything else untouched; the result validates as a PlanDocument."""
        raw = _v5_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated == {
            **raw,
            "schema_version": 9,
            "active_tool": None,
            "display_precision_in": None,
            "joints": [],
            "guides": [],
        }
        document = PlanDocument.model_validate(migrated)
        assert document.active_tool is None

    def test_migrate__when_document_is_v6__only_adds_the_unset_display_precision(
        self, migrator: PlanMigrator
    ) -> None:
        """A v6 document gains only the unset per-plan display precision and the empty joints and guides slots with schema version 9, keeping its active tool and everything else untouched; the result validates as a PlanDocument."""
        raw = _v6_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated == {
            **raw,
            "schema_version": 9,
            "display_precision_in": None,
            "joints": [],
            "guides": [],
        }
        document = PlanDocument.model_validate(migrated)
        assert document.display_precision_in is None
        assert document.active_tool == "wall"

    def test_migrate__when_document_is_v7__moves_connectivity_off_the_walls(
        self, migrator: PlanMigrator
    ) -> None:
        """The per-wall junctions are dropped rather than translated: connectivity is derivable from geometry, so the editor rebuilds the full relation set — corners and shared surfaces included — instead of carrying the T-only limitation forward."""
        raw = _v7_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated["schema_version"] == 9
        assert migrated["joints"] == []
        assert all("junctions" not in wall for wall in migrated["walls"])
        # Everything else about each wall survives untouched.
        assert [wall["id"] for wall in migrated["walls"]] == ["host", "partition"]
        assert migrated["walls"][1]["vertices"] == raw["walls"][1]["vertices"]
        PlanDocument.model_validate(migrated)

    def test_migrate__when_document_is_v7__leaves_the_caller_s_dict_untouched(
        self, migrator: PlanMigrator
    ) -> None:
        """Migration must not reach into the raw record it was handed: the repository reuses it, so stripping a nested key in place would corrupt the stored document."""
        raw = _v7_document()

        migrator.migrate(raw)

        assert raw["walls"][1]["junctions"] != []
        assert "joints" not in raw

    def test_migrate__when_document_is_v8__only_adds_the_empty_guide_collection(
        self, migrator: PlanMigrator
    ) -> None:
        """A v8 document gains only the empty guides slot with schema version 9: guides exist because the user placed them, so unlike wall connectivity there is nothing to derive; its walls and joints survive untouched."""
        raw = _v8_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated == {**raw, "schema_version": 9, "guides": []}
        document = PlanDocument.model_validate(migrated)
        assert document.guides == []
        assert [joint.id for joint in document.joints] == ["joint-partition-start"]

    def test_migrate__when_schema_version_is_missing__treats_document_as_v1(
        self, migrator: PlanMigrator
    ) -> None:
        """Legacy documents without a schema_version are migrated as version 1, not rejected."""
        raw = _v1_document()
        del raw["schema_version"]

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated["schema_version"] == 9

    def test_migrate__when_document_is_current__passes_through_untouched(
        self, migrator: PlanMigrator
    ) -> None:
        """A current-version document is returned as-is and reports that no step ran."""
        raw = PlanDocument().model_dump(mode="json")

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is False
        assert migrated == raw

    def test_migrate__when_version_is_above_current__raises_unsupported_version(
        self, migrator: PlanMigrator
    ) -> None:
        """Documents from a newer backend are refused instead of being downgraded."""
        raw = _v1_document()
        raw["schema_version"] = 99

        with pytest.raises(UnsupportedSchemaVersionError):
            migrator.migrate(raw)

    def test_migrate__when_migration_runs__does_not_mutate_the_input_dict(
        self, migrator: PlanMigrator
    ) -> None:
        """The caller keeps the pristine pre-migration dict for the backup copy."""
        raw = _v1_document()

        migrator.migrate(raw)

        assert raw == _v1_document()
