"""Tests for PlanMigrator forward-migration of raw document dicts."""

from typing import Any

import pytest
from backend.core.errors import InvalidSchemaVersionError, UnsupportedSchemaVersionError
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
    """Build a raw schema v7 document, carrying a wall drawn before per-wall colours."""
    return {
        **_v6_document(),
        "schema_version": 7,
        "display_precision_in": None,
        "walls": [
            {
                "id": "wall-1",
                "vertices": [{"x": 0.0, "y": 0.0}, {"x": 120.0, "y": 0.0}],
                "thickness_in": 3.5,
                "reference": "center",
                "closed": False,
                "locked_segments": [],
                "junctions": [],
            }
        ],
    }


def _v8_document() -> dict[str, Any]:
    """Build a raw schema v8 document, carrying a wall with an explicit colour override."""
    v7 = _v7_document()
    return {
        **v7,
        "schema_version": 8,
        "walls": [{**v7["walls"][0], "color": "#ff0000"}],
    }


def _v9_document() -> dict[str, Any]:
    """Build a raw schema v9 document: per-wall junctions still present, no joints or guides."""
    return {**_v8_document(), "schema_version": 9, "active_mode": "structure"}


class TestPlanMigrator:
    @pytest.fixture
    def migrator(self) -> PlanMigrator:
        """Migrator under test."""
        return PlanMigrator()

    def test_migrate__when_document_is_v1__walks_all_steps_to_v10(
        self, migrator: PlanMigrator
    ) -> None:
        """A v1 document gains the empty structure collections, the default thickness presets, the empty underlay slot, the empty device collections, the empty electrical-layout collections, the empty active-tool slot, the unset display precision, the per-wall colour slot and the empty active-mode slot, while keeping its viewport; the result validates as a PlanDocument."""
        raw = _v1_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated["schema_version"] == 10
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
        assert migrated["active_mode"] is None
        document = PlanDocument.model_validate(migrated)
        assert document.schema_version == 10

    def test_migrate__when_document_is_v2__adds_underlay_device_and_electrical_collections(
        self, migrator: PlanMigrator
    ) -> None:
        """A v2 document gains the underlay slot, the device and electrical-layout collections, the active-tool slot, the display-precision slot, the active-mode slot and schema version 10, keeping its structure content; the result validates as a PlanDocument."""
        raw = _v2_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated["schema_version"] == 10
        assert migrated["underlay"] is None
        assert migrated["devices"] == []
        assert migrated["catalog_defaults"] == {}
        assert migrated["circuits"] == []
        assert migrated["wires"] == []
        assert migrated["control_links"] == []
        assert migrated["active_tool"] is None
        assert migrated["display_precision_in"] is None
        assert migrated["active_mode"] is None
        assert migrated["viewport"] == raw["viewport"]
        assert migrated["thickness_presets_in"] == raw["thickness_presets_in"]
        document = PlanDocument.model_validate(migrated)
        assert document.underlay is None

    def test_migrate__when_document_is_v4__adds_electrical_collections_and_later_slots(
        self, migrator: PlanMigrator
    ) -> None:
        """A v4 document only gains the circuits, wires and control-link collections, the empty active-tool, display-precision and active-mode slots and schema version 10; the result validates as a PlanDocument."""
        raw = _v4_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated["schema_version"] == 10
        assert migrated["circuits"] == []
        assert migrated["wires"] == []
        assert migrated["control_links"] == []
        assert migrated["active_tool"] is None
        assert migrated["display_precision_in"] is None
        assert migrated["active_mode"] is None
        assert migrated["devices"] == []
        assert migrated["viewport"] == raw["viewport"]
        document = PlanDocument.model_validate(migrated)
        assert document.circuits == []
        assert document.wires == []
        assert document.control_links == []

    def test_migrate__when_document_is_v5__adds_the_active_tool_display_precision_and_active_mode_slots(
        self, migrator: PlanMigrator
    ) -> None:
        """A v5 document gains only the empty active-tool, display-precision and active-mode slots and schema version 10, keeping everything else untouched; the result validates as a PlanDocument."""
        raw = _v5_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated == {
            **raw,
            "schema_version": 10,
            "active_tool": None,
            "display_precision_in": None,
            "active_mode": None,
            "joints": [],
            "guides": [],
        }
        document = PlanDocument.model_validate(migrated)
        assert document.active_tool is None
        assert document.active_mode is None

    def test_migrate__when_document_is_v6__adds_the_unset_display_precision_and_active_mode(
        self, migrator: PlanMigrator
    ) -> None:
        """A v6 document gains only the unset per-plan display precision, the unset active mode and schema version 10, keeping its active tool and everything else untouched; the result validates as a PlanDocument."""
        raw = _v6_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated == {
            **raw,
            "schema_version": 10,
            "display_precision_in": None,
            "active_mode": None,
            "joints": [],
            "guides": [],
        }
        document = PlanDocument.model_validate(migrated)
        assert document.display_precision_in is None
        assert document.active_tool == "wall"
        assert document.active_mode is None

    def test_migrate__when_document_is_v7__gives_every_wall_an_unset_colour(
        self, migrator: PlanMigrator
    ) -> None:
        """A v7 document reaches v10 with each wall carrying an explicit empty colour, so it keeps taking the role default derived from the plan presets, and gains the unset active-mode slot; the caller's dict is left pristine for the backup."""
        raw = _v7_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated["schema_version"] == 10
        assert migrated["walls"][0]["color"] is None
        assert "junctions" not in migrated["walls"][0]
        assert migrated["active_mode"] is None
        assert raw == _v7_document()
        document = PlanDocument.model_validate(migrated)
        assert document.walls[0].color is None
        assert document.active_mode is None

    def test_migrate__when_document_is_v8__adds_the_unset_active_mode(
        self, migrator: PlanMigrator
    ) -> None:
        """A v8 document gains only the unset active-mode slot and schema version 10, keeping its active tool and per-wall colour untouched; the result validates as a PlanDocument."""
        raw = _v8_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        stripped = [{k: v for k, v in wall.items() if k != "junctions"} for wall in raw["walls"]]
        assert migrated == {
            **raw,
            "schema_version": 10,
            "active_mode": None,
            "walls": stripped,
            "joints": [],
            "guides": [],
        }
        document = PlanDocument.model_validate(migrated)
        assert document.active_mode is None
        assert document.active_tool == "wall"
        assert document.walls[0].color == "#ff0000"

    def test_migrate__when_a_wall_already_carries_a_colour__keeps_it(
        self, migrator: PlanMigrator
    ) -> None:
        """A colour written by a newer editor against an older document survives the step."""
        raw = _v7_document()
        raw["walls"][0]["color"] = "#ff0000"

        migrated, _ = migrator.migrate(raw)

        assert migrated["walls"][0]["color"] == "#ff0000"

    def test_migrate__when_document_is_v9__moves_connectivity_off_the_walls_and_adds_guides(
        self, migrator: PlanMigrator
    ) -> None:
        """The per-wall junctions are dropped rather than translated (connectivity is derivable from geometry, so the editor rebuilds the full relation set on open) and the empty joints and guides collections appear; the wall's colour and the active mode survive, and the caller's dict is left pristine for the backup."""
        raw = _v9_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated["schema_version"] == 10
        assert migrated["joints"] == []
        assert migrated["guides"] == []
        assert all("junctions" not in wall for wall in migrated["walls"])
        assert migrated["walls"][0]["color"] == "#ff0000"
        assert migrated["active_mode"] == "structure"
        assert raw == _v9_document()
        PlanDocument.model_validate(migrated)

    def test_migrate__when_schema_version_is_missing__treats_document_as_v1(
        self, migrator: PlanMigrator
    ) -> None:
        """Legacy documents without a schema_version are migrated as version 1, not rejected."""
        raw = _v1_document()
        del raw["schema_version"]

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated["schema_version"] == 10

    def test_migrate__when_document_is_current__passes_through_untouched(
        self, migrator: PlanMigrator
    ) -> None:
        """A current-version document is returned as-is and reports that no step ran."""
        raw = PlanDocument().model_dump(mode="json")

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is False
        assert migrated == raw

    @pytest.mark.parametrize("stored_version", [0, -3, 0.5])
    def test_migrate__when_version_is_below_the_first_one__reads_it_as_the_first_one(
        self, migrator: PlanMigrator, stored_version: float
    ) -> None:
        """A version below 1 says "before all of this", which is what version 1 already means: it walks forward from there rather than failing the step lookup and taking the whole read down with it."""
        raw = _v1_document()
        raw["schema_version"] = stored_version

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated["schema_version"] == 10

    def test_migrate__when_version_is_fractional__truncates_to_the_shape_it_claims(
        self, migrator: PlanMigrator
    ) -> None:
        """A version stored as a float names the shape it is at, not the one it is heading for."""
        raw = _v5_document()
        raw["schema_version"] = 5.9

        migrated, _ = migrator.migrate(raw)

        assert migrated == {
            **_v5_document(),
            "schema_version": 10,
            "active_tool": None,
            "display_precision_in": None,
            "active_mode": None,
            "joints": [],
            "guides": [],
        }

    @pytest.mark.parametrize("stored_version", ["5", None, True, [10], {"v": 10}, float("nan")])
    def test_migrate__when_version_is_not_a_number__raises_invalid_schema_version(
        self, migrator: PlanMigrator, stored_version: Any
    ) -> None:
        """The version is the one field with no sane default — which defaults the document is missing is exactly what it tells us — so an unreadable one is a domain error the API maps to 422, not a ValueError crashing the read."""
        raw = _v1_document()
        raw["schema_version"] = stored_version

        with pytest.raises(InvalidSchemaVersionError):
            migrator.migrate(raw)

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
