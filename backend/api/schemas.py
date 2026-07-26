"""Request and response schemas for the plans API.

Domain models (:class:`backend.models.plan.Plan`,
:class:`backend.models.plan_summary.PlanSummary`) serve directly as response
models; only request bodies and thin response wrappers are defined here.
"""

from typing import Annotated

from pydantic import BaseModel, Field

from backend.models.plan_document import PlanDocument


PLAN_NAME_MIN_LENGTH = 1
PLAN_NAME_MAX_LENGTH = 200
PLAN_DESCRIPTION_MAX_LENGTH = 2000


class PlanCreateRequest(BaseModel):
    """Body of ``POST /api/plans``.

    A bare ``{"name": ...}`` creates an empty plan; the optional fields let
    the home-page creation card seed the description, the underlay photo and
    the tier-2 plan settings in one call (spec P5).
    """

    name: str = Field(min_length=PLAN_NAME_MIN_LENGTH, max_length=PLAN_NAME_MAX_LENGTH)
    description: str = Field(default="", max_length=PLAN_DESCRIPTION_MAX_LENGTH)
    underlay_asset_id: str | None = None
    thickness_presets_in: list[Annotated[float, Field(gt=0)]] | None = None
    display_precision_in: float | None = Field(default=None, gt=0)


class PlanMetadataUpdateRequest(BaseModel):
    """Body of ``PATCH /api/plans/{plan_id}``; omitted fields are left unchanged."""

    name: str | None = Field(
        default=None, min_length=PLAN_NAME_MIN_LENGTH, max_length=PLAN_NAME_MAX_LENGTH
    )
    description: str | None = Field(default=None, max_length=PLAN_DESCRIPTION_MAX_LENGTH)


class PlanDocumentUpdateRequest(BaseModel):
    """Body of ``PUT /api/plans/{plan_id}`` (autosave with optimistic concurrency)."""

    revision: int
    document: PlanDocument


class RevisionResponse(BaseModel):
    """Response of a successful document update: the revision to use next."""

    revision: int
