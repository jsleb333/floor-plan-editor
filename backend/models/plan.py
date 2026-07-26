"""Plan domain model."""

from datetime import datetime

from pydantic import BaseModel

from backend.models.plan_document import PlanDocument


class Plan(BaseModel):
    """A floor plan with its metadata and full document.

    Role:
        Aggregate root of the application: identity, the ``name`` and
        ``description`` metadata shown on the home page (spec P5), lifecycle
        timestamps, the optimistic-concurrency ``revision`` counter, and the
        embedded :class:`PlanDocument`. ``archived_at`` marks a soft-deleted
        plan.
    """

    id: str
    name: str
    description: str = ""
    revision: int
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None
    document: PlanDocument
