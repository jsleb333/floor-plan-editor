"""Wire domain model."""

from pydantic import BaseModel, Field

from backend.models.point import Point


class Wire(BaseModel):
    """A curved connection between two devices on one circuit (spec sections 5.6 and 8).

    Role:
        The edge of a circuit's connectivity graph. Endpoints reference device
        ids (spec section 4.2: wire endpoints are device ids, never
        coordinates), so a wire follows its devices when they move; only the
        interior cubic-Bézier ``control_points`` are absolute plan coordinates
        (spec W2). Membership of a device in a circuit is defined by these
        wires reaching the panel (spec W4), not stored on the circuit.
    """

    id: str
    circuit_id: str
    from_device_id: str
    to_device_id: str
    control_points: list[Point] = Field(default_factory=list)
