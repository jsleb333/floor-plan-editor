"""Business logic for plan lifecycle management."""

import json
from datetime import UTC, datetime
from uuid import uuid4

from loguru import logger

from backend.constants import CURRENT_SCHEMA_VERSION, LEGACY_SCHEMA_VERSION
from backend.core.errors import PlanNotArchivedError, PlanNotFoundError, RevisionConflictError
from backend.core.plan_migrator import PlanMigrator
from backend.interfaces.plan_repository import PlanRepository
from backend.models.plan import Plan
from backend.models.plan_document import PlanDocument
from backend.models.plan_summary import PlanSummary
from backend.models.raw_plan_record import RawPlanRecord


DUPLICATE_NAME_SUFFIX = " (copy)"


class PlanService:
    """Business logic for the plan lifecycle.

    Role:
        Owns creation, listing, renaming, autosave document updates
        (optimistic concurrency), duplication, soft delete (archive/restore)
        and permanent deletion of plans. Reads migrate stored documents
        forward to the current schema version, keeping a pre-migration backup
        and persisting the migrated document. Persistence is delegated to the
        injected repository; this service enforces the domain rules and
        translates repository outcomes into domain exceptions.
    """

    def __init__(self, repo: PlanRepository, migrator: PlanMigrator) -> None:
        """Store the persistence and migration dependencies.

        Args:
            repo: Plan persistence port used for all storage operations.
            migrator: Brings raw stored documents up to the current schema
                version before they are validated into domain models.
        """
        self._repo = repo
        self._migrator = migrator

    async def create_plan(self, name: str) -> Plan:
        """Create a new empty plan.

        Args:
            name: Human-readable name of the plan.

        Returns:
            The created plan, with a fresh uuid, revision 1 and a default
            document.
        """
        now = datetime.now(UTC)
        plan = Plan(
            id=str(uuid4()),
            name=name,
            revision=1,
            created_at=now,
            updated_at=now,
            archived_at=None,
            document=PlanDocument(),
        )
        await self._repo.create(plan)
        logger.info("Created plan '{}' ({})", plan.name, plan.id)
        return plan

    async def list_plans(self) -> list[PlanSummary]:
        """List summaries of all plans, most recently updated first."""
        return await self._repo.list_summaries()

    async def get_plan(self, plan_id: str) -> Plan:
        """Fetch a full plan by id, migrating its document forward if needed.

        When the stored document predates the current schema version, it is
        migrated forward, a pre-migration backup is kept and the migrated
        document is persisted (bumping the revision) before being returned.

        Args:
            plan_id: Identifier of the plan to fetch.

        Returns:
            The full plan, its document at the current schema version.

        Raises:
            PlanNotFoundError: When no plan has this id.
        """
        record = await self._repo.get_raw(plan_id)
        if record is None:
            raise PlanNotFoundError(plan_id)
        migrated_dict, migrated = self._migrator.migrate(record.document)
        document = PlanDocument.model_validate(migrated_dict)
        revision, updated_at = record.revision, record.updated_at
        if migrated:
            revision, updated_at = await self._persist_migration(record, document)
        return Plan(
            id=record.id,
            name=record.name,
            revision=revision,
            created_at=record.created_at,
            updated_at=updated_at,
            archived_at=record.archived_at,
            document=document,
        )

    async def _persist_migration(
        self, record: RawPlanRecord, document: PlanDocument
    ) -> tuple[int, datetime]:
        """Back up the pre-migration document and store the migrated one.

        Args:
            record: Raw record as it was read from storage, its document still
                at the old schema version.
            document: Migrated document to persist.

        Returns:
            The revision and updated_at timestamp now current for the plan;
            the stored ones when a concurrent write pre-empted the migration.
        """
        now = datetime.now(UTC)
        from_version = int(record.document.get("schema_version", LEGACY_SCHEMA_VERSION))
        await self._repo.save_document_backup(
            record.id, from_version, json.dumps(record.document), now
        )
        new_revision = await self._repo.update_document(record.id, document, record.revision, now)
        if new_revision is None:
            logger.warning(
                "Plan {} was written concurrently during migration; keeping stored revision",
                record.id,
            )
            return record.revision, record.updated_at
        logger.info(
            "Migrated plan {} document from schema v{} to v{} (revision {})",
            record.id,
            from_version,
            document.schema_version,
            new_revision,
        )
        return new_revision, now

    async def rename_plan(self, plan_id: str, name: str) -> Plan:
        """Rename a plan.

        Args:
            plan_id: Identifier of the plan to rename.
            name: New plan name.

        Returns:
            The updated plan.

        Raises:
            PlanNotFoundError: When no plan has this id.
        """
        renamed = await self._repo.rename(plan_id, name, datetime.now(UTC))
        if not renamed:
            raise PlanNotFoundError(plan_id)
        logger.info("Renamed plan {} to '{}'", plan_id, name)
        return await self.get_plan(plan_id)

    async def update_document(
        self, plan_id: str, document: PlanDocument, expected_revision: int
    ) -> int:
        """Replace a plan's document (autosave), guarded by optimistic concurrency.

        The stored document always carries the current schema version: an
        incoming body written by an older client validates against the
        current model (every field added since v1 has a default), so its
        ``schema_version`` is normalized to the current one before storage
        instead of persisting a stale claim.

        Args:
            plan_id: Identifier of the plan to update.
            document: New document content to store.
            expected_revision: Revision the client believes to be current.

        Returns:
            The new revision to use for the next update.

        Raises:
            PlanNotFoundError: When no plan has this id.
            RevisionConflictError: When the expected revision is stale.
        """
        if document.schema_version != CURRENT_SCHEMA_VERSION:
            document = document.model_copy(update={"schema_version": CURRENT_SCHEMA_VERSION})
        new_revision = await self._repo.update_document(
            plan_id, document, expected_revision, datetime.now(UTC)
        )
        if new_revision is None:
            if await self._repo.get_raw(plan_id) is None:
                raise PlanNotFoundError(plan_id)
            raise RevisionConflictError(plan_id, expected_revision)
        logger.debug("Updated document of plan {} to revision {}", plan_id, new_revision)
        return new_revision

    async def duplicate_plan(self, plan_id: str) -> Plan:
        """Duplicate a plan with a fresh identity and the same document.

        Args:
            plan_id: Identifier of the plan to duplicate.

        Returns:
            The new plan, named after the source with a copy suffix,
            starting at revision 1 and not archived.
        """
        source = await self.get_plan(plan_id)
        now = datetime.now(UTC)
        duplicate = Plan(
            id=str(uuid4()),
            name=source.name + DUPLICATE_NAME_SUFFIX,
            revision=1,
            created_at=now,
            updated_at=now,
            archived_at=None,
            document=source.document.model_copy(deep=True),
        )
        await self._repo.create(duplicate)
        logger.info("Duplicated plan {} into '{}' ({})", plan_id, duplicate.name, duplicate.id)
        return duplicate

    async def archive_plan(self, plan_id: str) -> Plan:
        """Soft-delete a plan by marking it archived.

        Args:
            plan_id: Identifier of the plan to archive.

        Returns:
            The archived plan.

        Raises:
            PlanNotFoundError: When no plan has this id.
        """
        now = datetime.now(UTC)
        archived = await self._repo.set_archived(plan_id, now, now)
        if not archived:
            raise PlanNotFoundError(plan_id)
        logger.info("Archived plan {}", plan_id)
        return await self.get_plan(plan_id)

    async def restore_plan(self, plan_id: str) -> Plan:
        """Restore an archived plan.

        Args:
            plan_id: Identifier of the plan to restore.

        Returns:
            The restored plan.

        Raises:
            PlanNotFoundError: When no plan has this id.
        """
        restored = await self._repo.set_archived(plan_id, None, datetime.now(UTC))
        if not restored:
            raise PlanNotFoundError(plan_id)
        logger.info("Restored plan {}", plan_id)
        return await self.get_plan(plan_id)

    async def delete_plan_permanently(self, plan_id: str) -> None:
        """Permanently delete an archived plan.

        Args:
            plan_id: Identifier of the plan to delete.

        Raises:
            PlanNotArchivedError: When the plan is not archived; data is never
                destroyed without going through the soft-delete step first.
        """
        plan = await self.get_plan(plan_id)
        if plan.archived_at is None:
            raise PlanNotArchivedError(plan_id)
        await self._repo.delete(plan_id)
        logger.info("Permanently deleted plan {}", plan_id)
