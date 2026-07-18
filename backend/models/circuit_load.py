"""Per-circuit load computation result model."""

from typing import Literal

from pydantic import BaseModel


class CircuitLoad(BaseModel):
    """The computed electrical state of one circuit (spec C4/W4).

    Role:
        Read-only result of
        :class:`backend.core.circuit_validation_service.CircuitValidationService`
        for a single circuit: the summed load in watts over the devices
        connected to the panel, the derived amperage (``None`` for
        data/low-voltage circuits, which carry no load), the breaker rating it
        is compared against, and the resulting ``status`` — ``ok`` below 80 %
        of the breaker, ``warning`` at or above 80 % (the continuous-load rule
        of thumb) and ``over`` above 100 %. ``connected_device_ids`` are the
        devices reaching the panel on this circuit (excluding the panel);
        ``floating_device_ids`` are wired on this circuit but with no path to a
        panel (spec W4), and are excluded from the load sum.
    """

    circuit_id: str
    load_w: float
    amps: float | None
    breaker_a: int
    status: Literal["ok", "warning", "over"]
    connected_device_ids: list[str]
    floating_device_ids: list[str]
