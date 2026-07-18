"""Underlay domain model."""

from pydantic import BaseModel, Field

from backend.models.point import Point
from backend.models.underlay_transform import UnderlayTransform


DEFAULT_UNDERLAY_OPACITY = 0.4


class Underlay(BaseModel):
    """A raster image displayed under the plan for tracing.

    Role:
        References a server-stored image asset by id and carries its
        placement (calibrated transform), opacity and the layer flags that
        let the user lock or hide it independently of other layers
        (spec section 5.2).
    """

    image_ref: str
    transform: UnderlayTransform = Field(
        default_factory=lambda: UnderlayTransform(origin=Point(x=0.0, y=0.0))
    )
    opacity: float = Field(default=DEFAULT_UNDERLAY_OPACITY, ge=0, le=1)
    locked: bool = False
    visible: bool = True
