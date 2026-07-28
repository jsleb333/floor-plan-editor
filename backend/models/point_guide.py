"""Point-anchored guide domain model."""

from typing import Literal

from pydantic import BaseModel

from backend.models.wall_end_ref import WallEndRef


class PointGuide(BaseModel):
    """An infinite line through an anchored wall end, at a fixed angle.

    Role:
        The point-anchored case of the tape-measure tool (spec S9): the guide
        names the wall end it pivots on instead of caching its coordinates, so
        it follows that corner through every edit, and only ``angle_deg`` — in
        plan degrees, editable in the Inspector — is a stored value.
    """

    kind: Literal["point"] = "point"
    id: str
    anchor: WallEndRef
    angle_deg: float
