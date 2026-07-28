"""Free guide domain model."""

from typing import Literal

from pydantic import BaseModel

from backend.models.point import Point


class FreeGuide(BaseModel):
    """An infinite construction line anchored to nothing.

    Role:
        The unanchored case of the tape-measure tool (spec S9), placed where
        the clicks captured no plan content. Origin and angle are plain
        coordinates, so no constraint maintains them: the line stays exactly
        where it was drawn whatever the walls do.
    """

    kind: Literal["free"] = "free"
    id: str
    origin: Point
    angle_deg: float
