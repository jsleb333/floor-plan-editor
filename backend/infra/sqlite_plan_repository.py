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
    revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT NULL,
    document TEXT NOT NULL
)
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
INSERT INTO plans (id, name, revision, created_at, updated_at, archived_at, document)
VALUES (?, ?, ?, ?, ?, ?, ?)
"""

SELECT_SQL = """
SELECT id, name, revision, created_at, updated_at, archived_at, document
FROM plans WHERE id = ?
"""

LIST_SUMMARIES_SQL = """
SELECT id, name, updated_at, archived_at FROM plans ORDER BY updated_at DESC
"""

RENAME_SQL = "UPDATE plans SET name = ?, updated_at = ? WHERE id = ?"

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
        """Create the plans and document_backups tables if they do not exist yet."""
        await self._connection.execute(CREATE_TABLE_SQL)
        await self._connection.execute(CREATE_BACKUPS_TABLE_SQL)
        await self._connection.commit()

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
            revision=row[2],
            created_at=datetime.fromisoformat(row[3]),
            updated_at=datetime.fromisoformat(row[4]),
            archived_at=datetime.fromisoformat(row[5]) if row[5] else None,
            document=json.loads(row[6]),
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
                updated_at=datetime.fromisoformat(row[2]),
                archived_at=datetime.fromisoformat(row[3]) if row[3] else None,
            )
            for row in rows
        ]

    async def rename(self, plan_id: str, name: str, updated_at: datetime) -> bool:
        """Change a plan's name.

        Args:
            plan_id: Identifier of the plan to rename.
            name: New plan name.
            updated_at: Timestamp to record as the last modification time.

        Returns:
            True when a plan was renamed, False when the id is unknown.
        """
        cursor = await self._connection.execute(
            RENAME_SQL, (name, updated_at.isoformat(), plan_id)
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
