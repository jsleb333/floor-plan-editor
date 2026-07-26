"""Forward migration of plan documents to the current schema version."""

from typing import TYPE_CHECKING, Any

from loguru import logger

from backend.constants import (
    CURRENT_SCHEMA_VERSION,
    DEFAULT_THICKNESS_PRESETS_IN,
    LEGACY_SCHEMA_VERSION,
)
from backend.core.errors import UnsupportedSchemaVersionError


if TYPE_CHECKING:
    from collections.abc import Callable


class PlanMigrator:
    """Brings raw plan document dicts up to the current schema version.

    Role:
        Owns the ordered per-version migration steps (spec section 8): old
        documents are migrated forward, never rejected and never destroyed —
        the caller persists a pre-migration backup. Documents without a
        ``schema_version`` are treated as version 1. Documents newer than the
        current version are refused (never downgraded). Adding a new schema
        version means writing one new ``_migrate_vN_to_vN+1`` step and
        registering it.
    """

    def __init__(self) -> None:
        """Register the migration steps, keyed by the version they migrate from."""
        self._steps: dict[int, Callable[[dict[str, Any]], dict[str, Any]]] = {
            1: self._migrate_v1_to_v2,
            2: self._migrate_v2_to_v3,
            3: self._migrate_v3_to_v4,
            4: self._migrate_v4_to_v5,
            5: self._migrate_v5_to_v6,
        }

    def migrate(self, raw: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        """Migrate a raw document dict forward to the current schema version.

        Args:
            raw: Document dict exactly as stored; it is not mutated. A missing
                ``schema_version`` is treated as version 1.

        Returns:
            The migrated document dict and whether any migration step ran
            (False when the document is already current).

        Raises:
            UnsupportedSchemaVersionError: When the document's version is
                above the current schema version.
        """
        document = dict(raw)
        version = int(document.get("schema_version", LEGACY_SCHEMA_VERSION))
        if version > CURRENT_SCHEMA_VERSION:
            raise UnsupportedSchemaVersionError(version, CURRENT_SCHEMA_VERSION)
        migrated = False
        while version < CURRENT_SCHEMA_VERSION:
            document = self._steps[version](document)
            logger.debug("Migrated document from schema v{} to v{}", version, version + 1)
            version += 1
            migrated = True
        return document, migrated

    @staticmethod
    def _migrate_v1_to_v2(document: dict[str, Any]) -> dict[str, Any]:
        """Add the v2 structure collections and plan-level thickness presets.

        Args:
            document: A schema v1 document dict.

        Returns:
            The same dict brought to schema version 2, with empty element
            collections and the default thickness presets.
        """
        document.setdefault("walls", [])
        document.setdefault("openings", [])
        document.setdefault("stairs", [])
        document.setdefault("labels", [])
        document.setdefault("dimensions", [])
        document.setdefault("thickness_presets_in", list(DEFAULT_THICKNESS_PRESETS_IN))
        document["schema_version"] = 2
        return document

    @staticmethod
    def _migrate_v2_to_v3(document: dict[str, Any]) -> dict[str, Any]:
        """Add the v3 underlay slot (spec section 5.2), empty by default.

        Args:
            document: A schema v2 document dict.

        Returns:
            The same dict brought to schema version 3, with no underlay set.
        """
        document.setdefault("underlay", None)
        document["schema_version"] = 3
        return document

    @staticmethod
    def _migrate_v3_to_v4(document: dict[str, Any]) -> dict[str, Any]:
        """Add the v4 electrical device collection and plan-level catalog defaults.

        Args:
            document: A schema v3 document dict.

        Returns:
            The same dict brought to schema version 4, with no devices and
            pure catalog default loads (spec sections 5.4 and 5.9 tier 2).
        """
        document.setdefault("devices", [])
        document.setdefault("catalog_defaults", {})
        document["schema_version"] = 4
        return document

    @staticmethod
    def _migrate_v4_to_v5(document: dict[str, Any]) -> dict[str, Any]:
        """Add the v5 electrical layout collections (spec sections 5.5, 5.6, D6).

        Args:
            document: A schema v4 document dict.

        Returns:
            The same dict brought to schema version 5, with empty circuits,
            wires and control-link collections.
        """
        document.setdefault("circuits", [])
        document.setdefault("wires", [])
        document.setdefault("control_links", [])
        document["schema_version"] = 5
        return document

    @staticmethod
    def _migrate_v5_to_v6(document: dict[str, Any]) -> dict[str, Any]:
        """Add the v6 persisted active-tool slot (spec P4/E9), empty by default.

        Args:
            document: A schema v5 document dict.

        Returns:
            The same dict brought to schema version 6, with no active tool
            recorded — the editor falls back to its content-aware startup.
        """
        document.setdefault("active_tool", None)
        document["schema_version"] = 6
        return document
