"""Opening domain model."""

from typing import Literal

from pydantic import BaseModel, Field


class Opening(BaseModel):
    """A door or window hosted on a wall segment (spec S4/S5).

    Role:
        Parametric wall decoration (spec section 4.2): stores a host address
        (wall, segment, distance ``t`` in inches along the segment's reference
        line to the opening centre) instead of world coordinates, so it
        follows the wall through any edit. ``style``, ``hinge`` and ``swing``
        are meaningful for doors only; ``style`` selects the leaf
        configuration (single swing, double, sliding, bifold or pocket) and
        decides which of ``hinge``/``swing`` the drawn symbol reads.
    """

    id: str
    kind: Literal["door", "window"]
    wall_id: str
    segment_index: int = Field(ge=0)
    t: float
    width_in: float = Field(gt=0)
    style: Literal["swing", "double", "sliding", "bifold", "pocket"] = "swing"
    hinge: Literal["left", "right"] = "left"
    swing: Literal["in", "out"] = "in"
