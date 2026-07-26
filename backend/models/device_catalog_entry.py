"""Device catalog entry domain model."""

from typing import Literal

from pydantic import BaseModel

from backend.models.device_footprint import DeviceFootprint


class DeviceCatalogEntry(BaseModel):
    """One row of the device catalog (spec section 5.4).

    Role:
        Describes the physical defaults of a device type: how it mounts
        (on a wall, on the ceiling, or free-standing), its nominal voltage
        (``None`` for no-load control/data devices such as switches, network
        jacks, vacuum inlets and the panel itself), its default electrical
        load in watts and its default physical ``footprint`` in inches
        (``None`` for the symbolic types, which have no real size and draw at
        the editor's nominal pictogram size). Plan-level defaults (spec section
        5.9 tier 2) and per-device overrides refine these values without ever
        mutating the catalog.
    """

    mount: Literal["wall", "ceiling", "free"]
    voltage_v: int | None
    default_load_w: float
    footprint: DeviceFootprint | None = None
