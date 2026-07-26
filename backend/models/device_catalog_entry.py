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
        jacks, vacuum inlets and the sources themselves), its default
        electrical load in watts, whether it is a connectivity ``is_source``
        root, and its default physical ``footprint`` in inches (``None`` for
        the symbolic types, which have no real size and draw at the editor's
        nominal pictogram size). Plan-level defaults (spec section 5.9 tier 2)
        and per-device overrides refine these values without ever mutating the
        catalog.

        ``is_source`` marks the connectivity roots of the wire graph (spec
        C1/W4): the electrical panel and the inter-floor feeds. Circuit
        connectivity is walked from every source device, and sources are
        themselves excluded from the connected, floating, unassigned and
        multi-circuit findings — they feed circuits rather than draw from them.
    """

    mount: Literal["wall", "ceiling", "free"]
    voltage_v: int | None
    default_load_w: float
    is_source: bool = False
    footprint: DeviceFootprint | None = None
