"""Plan summary domain model."""

from datetime import datetime

from pydantic import BaseModel


class PlanSummary(BaseModel):
    """Lightweight listing view of a plan.

    Role:
        Metadata-only projection used by the plans home page; carries no
        document so listing stays cheap regardless of plan size. The
        ``description`` renders under the plan name on the home-page card
        (spec P5).
    """

    id: str
    name: str
    description: str = ""
    updated_at: datetime
    archived_at: datetime | None
