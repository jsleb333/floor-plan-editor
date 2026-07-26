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


class TestPlanMigrator:
    @pytest.fixture
    def migrator(self) -> PlanMigrator:
        """Migrator under test."""
        return PlanMigrator()

    def test_migrate__when_document_is_v1__walks_all_steps_to_v6(
        self, migrator: PlanMigrator
    ) -> None:
        """A v1 document gains the empty structure collections, the default thickness presets, the empty underlay slot, the empty device collections, the empty electrical-layout collections and the empty active-tool slot, while keeping its viewport; the result validates as a PlanDocument."""
        raw = _v1_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated["schema_version"] == 6
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
        document = PlanDocument.model_validate(migrated)
        assert document.schema_version == 6

    def test_migrate__when_document_is_v2__adds_underlay_device_and_electrical_collections(
        self, migrator: PlanMigrator
    ) -> None:
        """A v2 document gains the underlay slot, the device and electrical-layout collections, the active-tool slot and schema version 6, keeping its structure content; the result validates as a PlanDocument."""
        raw = _v2_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated["schema_version"] == 6
        assert migrated["underlay"] is None
        assert migrated["devices"] == []
        assert migrated["catalog_defaults"] == {}
        assert migrated["circuits"] == []
        assert migrated["wires"] == []
        assert migrated["control_links"] == []
        assert migrated["active_tool"] is None
        assert migrated["viewport"] == raw["viewport"]
        assert migrated["thickness_presets_in"] == raw["thickness_presets_in"]
        document = PlanDocument.model_validate(migrated)
        assert document.underlay is None

    def test_migrate__when_document_is_v4__adds_electrical_collections_and_active_tool(
        self, migrator: PlanMigrator
    ) -> None:
        """A v4 document only gains the circuits, wires and control-link collections, the empty active-tool slot and schema version 6; the result validates as a PlanDocument."""
        raw = _v4_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated["schema_version"] == 6
        assert migrated["circuits"] == []
        assert migrated["wires"] == []
        assert migrated["control_links"] == []
        assert migrated["active_tool"] is None
        assert migrated["devices"] == []
        assert migrated["viewport"] == raw["viewport"]
        document = PlanDocument.model_validate(migrated)
        assert document.circuits == []
        assert document.wires == []
        assert document.control_links == []

    def test_migrate__when_document_is_v5__only_adds_the_empty_active_tool_slot(
        self, migrator: PlanMigrator
    ) -> None:
        """A v5 document gains only the empty active-tool slot and schema version 6, keeping everything else untouched; the result validates as a PlanDocument."""
        raw = _v5_document()

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated == {**raw, "schema_version": 6, "active_tool": None}
        document = PlanDocument.model_validate(migrated)
        assert document.active_tool is None

    def test_migrate__when_schema_version_is_missing__treats_document_as_v1(
        self, migrator: PlanMigrator
    ) -> None:
        """Legacy documents without a schema_version are migrated as version 1, not rejected."""
        raw = _v1_document()
        del raw["schema_version"]

        migrated, did_migrate = migrator.migrate(raw)

        assert did_migrate is True
        assert migrated["schema_version"] == 6

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
