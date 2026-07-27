"""Wall domain model."""

from typing import Literal

from pydantic import BaseModel, Field

from backend.models.point import Point


class Wall(BaseModel):
    """A wall chain stored as its reference polyline (spec S1/S1a).

    Role:
        Single source of truth for wall geometry: an ordered list of
        reference-line vertices plus thickness and the side the thickness is
        applied on. The rendered outline (offset faces, mitres, caps) is
        derived and never persisted. ``locked_segments`` holds indices of
        segments immune to edits (spec S3b). Connectivity to other walls is
        NOT stored here: it lives in ``PlanDocument.joints`` so a relation is
        symmetric and one place owns it (see ``docs/WALL_NETWORK.md``).
    """

    id: str
    vertices: list[Point] = Field(min_length=2)
    thickness_in: float = Field(gt=0)
    reference: Literal["center", "left", "right"] = "center"
    closed: bool = False
    locked_segments: list[int] = Field(default_factory=list)
