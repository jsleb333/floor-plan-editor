"""Opening domain model."""

from typing import Literal

from pydantic import BaseModel, Field


class Opening(BaseModel):
    """A door or window hosted on a wall segment (spec S4/S5).

    Role:
        Parametric wall decoration (spec section 4.2): stores a host address
        (wall, segment, distance ``t`` in inches along the segment's reference
        line to the opening centre) instead of world coordinates, so it
        follows the wall through any edit. ``hinge`` and ``swing`` are
        meaningful for doors only.
    """

    id: str
    kind: Literal["door", "window"]
    wall_id: str
    segment_index: int = Field(ge=0)
    t: float
    width_in: float = Field(gt=0)
    hinge: Literal["left", "right"] = "left"
    swing: Literal["in", "out"] = "in"
