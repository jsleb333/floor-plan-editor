"""Dimension annotation domain model."""

from pydantic import BaseModel

from backend.models.point import Point


class Dimension(BaseModel):
    """A persistent dimension line between two points (spec S8).

    Role:
        Annotation that displays the real distance between ``p1`` and ``p2``,
        drawn offset from the measured line by ``offset_in`` inches. The
        displayed value is derived live from the anchor points.
    """

    id: str
    p1: Point
    p2: Point
    offset_in: float = 12
