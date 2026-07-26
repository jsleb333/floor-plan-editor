"""SQLite adapter for plan persistence."""

import json
from datetime import datetime

import aiosqlite

from backend.interfaces.plan_repository import PlanRepository
from backend.models.plan import Plan
from backend.models.plan_document import PlanDocument
from backend.models.plan_summary import PlanSummary
from backend.models.raw_plan_record import RawPlanRecord


CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT NULL,
    document TEXT NOT NULL
)
"""

PLANS_TABLE_INFO_SQL = "PRAGMA table_info(plans)"

ADD_DESCRIPTION_COLUMN_SQL = """
ALTER TABLE plans ADD COLUMN description TEXT NOT NULL DEFAULT ''
"""

CREATE_BACKUPS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS document_backups (
    plan_id TEXT NOT NULL,
    from_version INTEGER NOT NULL,
    document TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (plan_id, from_version)
)
"""

INSERT_SQL = """
INSERT INTO plans (id, name, description, revision, created_at, updated_at, archived_at, document)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
"""

SELECT_SQL = """
SELECT id, name, description, revision, created_at, updated_at, archived_at, document
FROM plans WHERE id = ?
"""

LIST_SUMMARIES_SQL = """
SELECT id, name, description, updated_at, archived_at FROM plans ORDER BY updated_at DESC
"""

UPDATE_METADATA_SQL = """
UPDATE plans SET name = COALESCE(?, name), description = COALESCE(?, description), updated_at = ?
WHERE id = ?
"""

UPDATE_DOCUMENT_SQL = """
UPDATE plans SET document = ?, revision = revision + 1, updated_at = ?
WHERE id = ? AND revision = ?
"""

INSERT_BACKUP_SQL = """
INSERT OR IGNORE INTO document_backups (plan_id, from_version, document, created_at)
VALUES (?, ?, ?, ?)
"""

SET_ARCHIVED_SQL = "UPDATE plans SET archived_at = ?, updated_at = ? WHERE id = ?"

DELETE_SQL = "DELETE FROM plans WHERE id = ?"


class SqlitePlanRepository(PlanRepository):
    """SQLite implementation of the plan persistence port.

    Role:
        Stores plans in a single ``plans`` table used as a document store:
        the document as a JSON text column, plus metadata columns for cheap
        listing and optimistic concurrency. Pre-migration document copies
        live in ``document_backups``, one per plan and source schema version
        (the oldest copy is kept). Timestamps are stored as timezone-aware
        ISO-8601 strings.
    """

    def __init__(self, connection: aiosqlite.Connection) -> None:
        """Wrap an open database connection.

        Args:
            connection: Open aiosqlite connection to the plans database; the
                repository never opens or closes it (the container owns its
                lifecycle).
        """
        self._connection = connection

    async def initialize(self) -> None:
        """Create the tables if missing and apply additive column migrations.

        Databases created before the ``description`` column existed gain it
        through an additive ``ALTER TABLE`` with a default; existing rows are
        never dropped or rewritten.
        """
        await self._connection.execute(CREATE_TABLE_SQL)
        await self._connection.execute(CREATE_BACKUPS_TABLE_SQL)
        await self._ensure_description_column()
        await self._connection.commit()

    async def _ensure_description_column(self) -> None:
        """Add the description column to a pre-existing plans table lacking it."""
        cursor = await self._connection.execute(PLANS_TABLE_INFO_SQL)
        columns = {row[1] for row in await cursor.fetchall()}
        if "description" not in columns:
            await self._connection.execute(ADD_DESCRIPTION_COLUMN_SQL)

    async def create(self, plan: Plan) -> None:
        """Persist a new plan.

        Args:
            plan: Fully populated plan to store; its id must not already exist.
        """
        await self._connection.execute(
            INSERT_SQL,
            (
                plan.id,
                plan.name,
                plan.description,
                plan.revision,
                plan.created_at.isoformat(),
                plan.updated_at.isoformat(),
                plan.archived_at.isoformat() if plan.archived_at else None,
                plan.document.model_dump_json(),
            ),
        )
        await self._connection.commit()

    async def get_raw(self, plan_id: str) -> RawPlanRecord | None:
        """Fetch a plan row with its document as a raw, un-validated dict.

        Args:
            plan_id: Identifier of the plan to fetch.

        Returns:
            The raw record, or None when no plan has this id.
        """
        cursor = await self._connection.execute(SELECT_SQL, (plan_id,))
        row = await cursor.fetchone()
        if row is None:
            return None
        return RawPlanRecord(
            id=row[0],
            name=row[1],
            description=row[2],
            revision=row[3],
            created_at=datetime.fromisoformat(row[4]),
            updated_at=datetime.fromisoformat(row[5]),
            archived_at=datetime.fromisoformat(row[6]) if row[6] else None,
            document=json.loads(row[7]),
        )

    async def list_summaries(self) -> list[PlanSummary]:
        """List metadata summaries of all plans.

        Returns:
            Summaries of every stored plan (archived included), most recently
            updated first.
        """
        cursor = await self._connection.execute(LIST_SUMMARIES_SQL)
        rows = await cursor.fetchall()
        return [
            PlanSummary(
                id=row[0],
                name=row[1],
                description=row[2],
                updated_at=datetime.fromisoformat(row[3]),
                archived_at=datetime.fromisoformat(row[4]) if row[4] else None,
            )
            for row in rows
        ]

    async def update_metadata(
        self, plan_id: str, name: str | None, description: str | None, updated_at: datetime
    ) -> bool:
        """Change a plan's listing metadata; None fields keep their stored value.

        Args:
            plan_id: Identifier of the plan to update.
            name: New plan name, or None to leave the name unchanged.
            description: New plan description, or None to leave it unchanged.
            updated_at: Timestamp to record as the last modification time.

        Returns:
            True when a plan was updated, False when the id is unknown.
        """
        cursor = await self._connection.execute(
            UPDATE_METADATA_SQL, (name, description, updated_at.isoformat(), plan_id)
        )
        await self._connection.commit()
        return cursor.rowcount > 0

    async def update_document(
        self,
        plan_id: str,
        document: PlanDocument,
        expected_revision: int,
        updated_at: datetime,
    ) -> int | None:
        """Replace a plan's document, guarded by optimistic concurrency.

        Args:
            plan_id: Identifier of the plan to update.
            document: New document content to store.
            expected_revision: Revision the caller believes to be current; the
                update only applies when it matches the stored revision.
            updated_at: Timestamp to record as the last modification time.

        Returns:
            The new (incremented) revision on success, or None when the plan
            is missing or the expected revision is stale.
        """
        cursor = await self._connection.execute(
            UPDATE_DOCUMENT_SQL,
            (document.model_dump_json(), updated_at.isoformat(), plan_id, expected_revision),
        )
        await self._connection.commit()
        if cursor.rowcount == 0:
            return None
        return expected_revision + 1

    async def save_document_backup(
        self, plan_id: str, from_version: int, raw_document_json: str, created_at: datetime
    ) -> None:
        """Keep a pre-migration copy of a document; the oldest copy per version wins.

        Args:
            plan_id: Identifier of the plan whose document is backed up.
            from_version: Schema version of the document being backed up.
            raw_document_json: Document JSON exactly as stored before migration.
            created_at: Timestamp of the backup.
        """
        await self._connection.execute(
            INSERT_BACKUP_SQL,
            (plan_id, from_version, raw_document_json, created_at.isoformat()),
        )
        await self._connection.commit()

    async def set_archived(
        self, plan_id: str, archived_at: datetime | None, updated_at: datetime
    ) -> bool:
        """Set or clear a plan's archived state.

        Args:
            plan_id: Identifier of the plan to archive or restore.
            archived_at: Archival timestamp, or None to restore the plan.
            updated_at: Timestamp to record as the last modification time.

        Returns:
            True when a plan was updated, False when the id is unknown.
        """
        cursor = await self._connection.execute(
            SET_ARCHIVED_SQL,
            (
                archived_at.isoformat() if archived_at else None,
                updated_at.isoformat(),
                plan_id,
            ),
        )
        await self._connection.commit()
        return cursor.rowcount > 0

    async def delete(self, plan_id: str) -> bool:
        """Permanently remove a plan.

        Args:
            plan_id: Identifier of the plan to delete.

        Returns:
            True when a plan was deleted, False when the id is unknown.
        """
        cursor = await self._connection.execute(DELETE_SQL, (plan_id,))
        await self._connection.commit()
        return cursor.rowcount > 0
