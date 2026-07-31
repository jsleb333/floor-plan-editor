"""Forward migration of plan documents to the current schema version."""

from math import isfinite
from typing import TYPE_CHECKING, Any

from loguru import logger

from backend.constants import (
    CURRENT_SCHEMA_VERSION,
    DEFAULT_THICKNESS_PRESETS_IN,
    LEGACY_SCHEMA_VERSION,
)
from backend.core.errors import InvalidSchemaVersionError, UnsupportedSchemaVersionError


if TYPE_CHECKING:
    from collections.abc import Callable


class PlanMigrator:
    """Brings raw plan document dicts up to the current schema version.

    Role:
        Owns the ordered per-version migration steps (spec section 8): old
        documents are migrated forward, never rejected and never destroyed —
        the caller persists a pre-migration backup. Documents without a
        ``schema_version`` are treated as version 1, as are documents claiming
        a version below it; documents newer than the current version are
        refused (never downgraded) and a version that is not a number at all
        is refused as unreadable. Adding a new schema version means writing one
        new ``_migrate_vN_to_vN+1`` step and registering it.

        The frontend read funnel (``frontend/src/schema/planDocumentSchema.ts``)
        mirrors this class end to end: every step below gives a newly added
        field its default, which is what the Zod ``.default()``s there do on
        read, and the shared corpus in ``tests/fixtures/plan_migration/`` pins
        the two implementations to the same output.
    """

    def __init__(self) -> None:
        """Register the migration steps, keyed by the version they migrate from."""
        self._steps: dict[int, Callable[[dict[str, Any]], dict[str, Any]]] = {
            1: self._migrate_v1_to_v2,
            2: self._migrate_v2_to_v3,
            3: self._migrate_v3_to_v4,
            4: self._migrate_v4_to_v5,
            5: self._migrate_v5_to_v6,
            6: self._migrate_v6_to_v7,
            7: self._migrate_v7_to_v8,
            8: self._migrate_v8_to_v9,
            9: self._migrate_v9_to_v10,
        }

    def migrate(self, raw: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        """Migrate a raw document dict forward to the current schema version.

        The version the document claims is resolved by :meth:`_resolve_version`,
        which also refuses one that is not a number.

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
        version = self._resolve_version(document.get("schema_version", LEGACY_SCHEMA_VERSION))
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
    def _resolve_version(raw: Any) -> int:
        """Read the version a document claims, mirrored by the frontend read funnel.

        Args:
            raw: Value stored under ``schema_version``, already defaulted to
                :data:`LEGACY_SCHEMA_VERSION` when the key was absent.

        Returns:
            The claimed version, never below :data:`LEGACY_SCHEMA_VERSION`: a
            fractional version is truncated to the version whose shape it
            claims, and anything below the first version is read as the first
            one rather than refused — a ``0`` says "before all of this", which
            is what version 1 already means. Refusing it instead would only
            trade a stored typo for an unopenable plan.

        Raises:
            InvalidSchemaVersionError: When the value is not a real number. It
                is the one field that cannot fall back to a default: which
                defaults the document is missing is exactly what it tells us.
        """
        if isinstance(raw, bool) or not isinstance(raw, int | float) or not isfinite(raw):
            raise InvalidSchemaVersionError(raw)
        return max(int(raw), LEGACY_SCHEMA_VERSION)

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

    @staticmethod
    def _migrate_v6_to_v7(document: dict[str, Any]) -> dict[str, Any]:
        """Add the v7 per-plan display precision override (spec section 5.9 tier 2).

        Args:
            document: A schema v6 document dict.

        Returns:
            The same dict brought to schema version 7, with no precision
            override set — display falls back to the app preference.
        """
        document.setdefault("display_precision_in", None)
        document["schema_version"] = 7
        return document

    @staticmethod
    def _migrate_v7_to_v8(document: dict[str, Any]) -> dict[str, Any]:
        """Add the v8 per-wall colour override (spec S1f).

        Args:
            document: A schema v7 document dict.

        Returns:
            The same dict brought to schema version 8, with every wall left
            without an explicit colour — each keeps taking the role default
            derived from the plan's thickness presets. Wall dicts are copied
            rather than edited in place, so the caller's pre-migration backup
            stays pristine.
        """
        walls = document.get("walls")
        if isinstance(walls, list):
            document["walls"] = [
                {"color": None, **wall} if isinstance(wall, dict) else wall for wall in walls
            ]
        document["schema_version"] = 8
        return document

    @staticmethod
    def _migrate_v8_to_v9(document: dict[str, Any]) -> dict[str, Any]:
        """Add the v9 persisted active-mode slot (spec P4/E10), empty by default.

        Args:
            document: A schema v8 document dict.

        Returns:
            The same dict brought to schema version 9, with no active mode
            recorded — the editor falls back to its content-aware startup.
        """
        document.setdefault("active_mode", None)
        document["schema_version"] = 9
        return document

    @staticmethod
    def _migrate_v9_to_v10(document: dict[str, Any]) -> dict[str, Any]:
        """Move wall connectivity into ``joints`` and add the ``guides`` slot.

        One step for two features (spec S1b/S3a wall network, spec S9 guides)
        because they shipped together. The old per-wall ``junctions`` list could
        only express "my endpoint sits on that wall", one-way and T-only; it is
        dropped rather than translated — connectivity is derivable from
        geometry, so the editor rebuilds the full relation set (corners and
        shared surfaces included) on first open and stores that. Wall dicts are
        copied rather than edited in place, so the caller's pre-migration
        backup stays pristine.

        Args:
            document: A schema v9 document dict.

        Returns:
            The same dict brought to schema version 10, with empty ``joints``
            and ``guides`` collections and no ``junctions`` key on any wall.
        """
        walls = document.get("walls")
        if isinstance(walls, list):
            document["walls"] = [
                {key: value for key, value in wall.items() if key != "junctions"}
                if isinstance(wall, dict)
                else wall
                for wall in walls
            ]
        document.setdefault("joints", [])
        document.setdefault("guides", [])
        document["schema_version"] = 10
        return document
