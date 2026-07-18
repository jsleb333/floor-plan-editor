"""Underlay transform domain model."""

from pydantic import BaseModel, Field

from backend.models.point import Point


class UnderlayTransform(BaseModel):
    """Placement of an underlay image in plan coordinates.

    Role:
        Maps image pixels to plan inches. ``origin`` is the plan position (in
        inches) of the image's top-left pixel, ``rotation_deg`` rotates the
        image around that origin, and ``scale`` is the number of inches one
        image pixel covers. Calibration (drawing a reference segment on the
        image and typing its real length) computes ``scale`` client-side; the
        backend only stores the result.
    """

    origin: Point
    rotation_deg: float = 0
    scale: float = Field(default=1, gt=0)
