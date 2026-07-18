"""Port for plan persistence."""

from abc import ABC, abstractmethod
from datetime import datetime

from backend.models.plan import Plan
from backend.models.plan_document import PlanDocument
from backend.models.plan_summary import PlanSummary
from backend.models.raw_plan_record import RawPlanRecord


class PlanRepository(ABC):
    """Persistence port for plans.

    Role:
        Contract every plan storage adapter must fulfil. Services depend on
        this interface only; concrete adapters (e.g. SQLite) live in
        ``backend/infra``. Reads return the document as a raw dict
        (:class:`RawPlanRecord`) so the service layer can run schema
        migrations before validating it into a domain model.
    """

    @abstractmethod
    async def create(self, plan: Plan) -> None:
        """Persist a new plan.

        Args:
            plan: Fully populated plan to store; its id must not already exist.
        """

    @abstractmethod
    async def get_raw(self, plan_id: str) -> RawPlanRecord | None:
        """Fetch a plan row with its document as a raw, un-validated dict.

        Args:
            plan_id: Identifier of the plan to fetch.

        Returns:
            The raw record, or None when no plan has this id.
        """

    @abstractmethod
    async def list_summaries(self) -> list[PlanSummary]:
        """List metadata summaries of all plans.

        Returns:
            Summaries of every stored plan (archived included), most recently
            updated first.
        """

    @abstractmethod
    async def rename(self, plan_id: str, name: str, updated_at: datetime) -> bool:
        """Change a plan's name.

        Args:
            plan_id: Identifier of the plan to rename.
            name: New plan name.
            updated_at: Timestamp to record as the last modification time.

        Returns:
            True when a plan was renamed, False when the id is unknown.
        """

    @abstractmethod
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

    @abstractmethod
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

    @abstractmethod
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

    @abstractmethod
    async def delete(self, plan_id: str) -> bool:
        """Permanently remove a plan.

        Args:
            plan_id: Identifier of the plan to delete.

        Returns:
            True when a plan was deleted, False when the id is unknown.
        """
