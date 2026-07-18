"""Device catalog entry domain model."""

from typing import Literal

from pydantic import BaseModel


class DeviceCatalogEntry(BaseModel):
    """One row of the device catalog (spec section 5.4).

    Role:
        Describes the physical defaults of a device type: how it mounts
        (on a wall, on the ceiling, or free-standing), its nominal voltage
        (``None`` for no-load control/data devices such as switches, network
        jacks, vacuum inlets and the panel itself) and its default electrical
        load in watts. Plan-level defaults (spec section 5.9 tier 2) and
        per-device overrides refine these values without ever mutating the
        catalog.
    """

    mount: Literal["wall", "ceiling", "free"]
    voltage_v: int | None
    default_load_w: float
