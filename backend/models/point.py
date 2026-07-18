"""2D point domain model."""

from pydantic import BaseModel


class Point(BaseModel):
    """A 2D point in plan coordinates.

    Role:
        Canonical coordinate value object; coordinates are expressed in
        inches, the internal canonical unit of the editor.
    """

    x: float
    y: float
