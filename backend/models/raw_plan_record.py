"""Raw plan record domain model."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class RawPlanRecord(BaseModel):
    """A stored plan row with its document still un-validated.

    Role:
        Bridge between persistence and migration: carries the plan metadata
        plus the document as the raw dict exactly as stored, so schema
        migrations can run *before* the document is validated into
        :class:`backend.models.plan_document.PlanDocument`.
    """

    id: str
    name: str
    description: str = ""
    revision: int
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None
    document: dict[str, Any]
