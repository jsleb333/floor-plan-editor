"""Wall end attachment domain model."""

from typing import Literal

from pydantic import BaseModel, Field


class WallEndAttachment(BaseModel):
    """A T-junction: one endpoint of a wall lives on another wall.

    Role:
        Parametric host address of a wall endpoint (spec S3a). Instead of a
        world coordinate, the endpoint stores which segment of the host wall
        it sits on and how far along that segment's reference line, so the
        junction stays attached when either wall moves.
    """

    end: Literal["start", "end"]
    host_wall_id: str
    segment_index: int = Field(ge=0)
    t: float
