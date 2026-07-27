"""Tee joint domain model."""

from typing import Literal

from pydantic import BaseModel

from backend.models.wall_body_ref import WallBodyRef
from backend.models.wall_end_ref import WallEndRef


class TeeJoint(BaseModel):
    """One wall end abutting another wall's body.

    Role:
        The T relation (spec S3a). The butting end is clipped to the host's
        near surface when the geometry is derived; the host itself is
        unaffected, which is what makes the relation one-directional.
    """

    kind: Literal["tee"] = "tee"
    id: str
    end: WallEndRef
    host: WallBodyRef
