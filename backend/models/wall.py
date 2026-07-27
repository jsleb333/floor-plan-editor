"""Wall domain model."""

from typing import Literal

from pydantic import BaseModel, Field

from backend.constants import HEX_COLOR_PATTERN
from backend.models.point import Point
from backend.models.wall_end_attachment import WallEndAttachment


class Wall(BaseModel):
    """A wall chain stored as its reference polyline (spec S1/S1a).

    Role:
        Single source of truth for wall geometry: an ordered list of
        reference-line vertices plus thickness and the side the thickness is
        applied on. The rendered outline (offset faces, mitres, caps) is
        derived and never persisted. ``locked_segments`` holds indices of
        segments immune to edits (spec S3b) and ``junctions`` records
        T-junction endpoint attachments onto other walls (spec S3a).
        ``color`` is the per-wall override of the drawn wall body (spec S1f);
        ``None`` means the wall takes the role default the frontend derives
        from the plan's thickness presets (black exterior, grey interior).
    """

    id: str
    vertices: list[Point] = Field(min_length=2)
    thickness_in: float = Field(gt=0)
    reference: Literal["center", "left", "right"] = "center"
    closed: bool = False
    locked_segments: list[int] = Field(default_factory=list)
    junctions: list[WallEndAttachment] = Field(default_factory=list)
    color: str | None = Field(default=None, pattern=HEX_COLOR_PATTERN)
