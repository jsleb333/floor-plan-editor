"""Label domain model."""

from pydantic import BaseModel

from backend.models.point import Point


class Label(BaseModel):
    """A free-placed text label (spec S7).

    Role:
        Room or annotation text anchored at an absolute position, with a font
        size expressed in inches of plan space so it scales with the drawing.
    """

    id: str
    position: Point
    text: str
    size_in: float = 8
