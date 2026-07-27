"""Wall body reference domain model."""

from pydantic import BaseModel, Field


class WallBodyRef(BaseModel):
    """A wall body a joint passes through, identified by the segment it crosses.

    Role:
        The host half of a T (spec S3a): an end abuts a wall's body somewhere
        along one of its segments, and the segment index is what keeps that
        addressable while the wall is reshaped.
    """

    wall_id: str
    segment_index: int = Field(ge=0)
