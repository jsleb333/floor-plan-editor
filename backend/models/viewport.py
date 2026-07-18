"""Viewport domain model."""

from pydantic import BaseModel, Field

from backend.models.point import Point


class Viewport(BaseModel):
    """The visible area of a plan in the editor.

    Role:
        Stores the last camera position of the editor so a plan reopens
        exactly where the user left it. ``center`` is in inches and ``zoom``
        is a strictly positive scale factor.
    """

    center: Point
    zoom: float = Field(gt=0)
