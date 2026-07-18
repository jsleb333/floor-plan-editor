"""Stairs domain model."""

from typing import Literal

from pydantic import BaseModel

from backend.models.point import Point


class Stairs(BaseModel):
    """A rectangular stair run with a direction arrow (spec S6).

    Role:
        Free-standing structure element: a rectangle of ``width_in`` by
        ``length_in`` inches anchored at ``origin``, rotated by
        ``rotation_deg`` degrees, labelled as going up or down.
    """

    id: str
    origin: Point
    width_in: float
    length_in: float
    rotation_deg: float = 0
    direction: Literal["up", "down"] = "up"
