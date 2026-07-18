"""Request and response schemas for the plans API.

Domain models (:class:`backend.models.plan.Plan`,
:class:`backend.models.plan_summary.PlanSummary`) serve directly as response
models; only request bodies and thin response wrappers are defined here.
"""

from pydantic import BaseModel, Field

from backend.models.plan_document import PlanDocument


PLAN_NAME_MIN_LENGTH = 1
PLAN_NAME_MAX_LENGTH = 200


class PlanCreateRequest(BaseModel):
    """Body of ``POST /api/plans``."""

    name: str = Field(min_length=PLAN_NAME_MIN_LENGTH, max_length=PLAN_NAME_MAX_LENGTH)


class PlanRenameRequest(BaseModel):
    """Body of ``PATCH /api/plans/{plan_id}``."""

    name: str = Field(min_length=PLAN_NAME_MIN_LENGTH, max_length=PLAN_NAME_MAX_LENGTH)


class PlanDocumentUpdateRequest(BaseModel):
    """Body of ``PUT /api/plans/{plan_id}`` (autosave with optimistic concurrency)."""

    revision: int
    document: PlanDocument


class RevisionResponse(BaseModel):
    """Response of a successful document update: the revision to use next."""

    revision: int
