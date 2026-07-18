"""Device wall-attachment domain model."""

from typing import Literal

from pydantic import BaseModel, Field


class DeviceAttachment(BaseModel):
    """Parametric host address of a wall-mounted device (spec section 4.2).

    Role:
        Stores where a device sits on a wall instead of world coordinates:
        the host wall, the segment on its reference polyline, the distance
        ``t`` in inches from the segment start along the reference line, and
        which face of the wall the device sits on. The world position is
        always derived from the host wall's current geometry, so the device
        follows the wall through any edit.
    """

    wall_id: str
    segment_index: int = Field(ge=0)
    t: float
    side: Literal["left", "right"] = "left"
