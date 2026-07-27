"""Wall end reference domain model."""

from typing import Literal

from pydantic import BaseModel


class WallEndRef(BaseModel):
    """One wall end participating in a joint.

    Role:
        Identity half of the wall network's topology (spec S1b/S3a, see
        ``docs/WALL_NETWORK.md``): a joint names the wall ends it relates
        rather than caching their coordinates, so the relation survives any
        edit that moves them.
    """

    wall_id: str
    end: Literal["start", "end"]
