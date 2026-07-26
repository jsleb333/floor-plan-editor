"""Electrical device type registry (spec sections 5.4 and D5)."""

from enum import StrEnum

from backend.models.device_catalog_entry import DeviceCatalogEntry
from backend.models.device_footprint import DeviceFootprint


class DeviceType(StrEnum):
    """The catalog of placeable electrical device types (spec section 5.4).

    Role:
        Data-driven device-type registry (spec D5): every placeable pictogram
        is one member, and ``DEVICE_CATALOG`` maps each member to its physical
        defaults. Adding a device type means adding a member and its catalog
        row — no editor logic changes.
    """

    OUTLET = "outlet"
    OUTLET_GFCI = "outlet_gfci"
    SWITCH = "switch"
    SWITCH_3WAY = "switch_3way"
    CEILING_LIGHT = "ceiling_light"
    WALL_LIGHT = "wall_light"
    BASEBOARD_HEATER = "baseboard_heater"
    THERMOSTAT = "thermostat"
    WATER_HEATER = "water_heater"
    AIR_EXCHANGER = "air_exchanger"
    CENTRAL_VACUUM = "central_vacuum"
    VACUUM_INLET = "vacuum_inlet"
    SMOKE_DETECTOR = "smoke_detector"
    NETWORK_JACK = "network_jack"
    PANEL = "panel"


DEVICE_CATALOG: dict[DeviceType, DeviceCatalogEntry] = {
    DeviceType.OUTLET: DeviceCatalogEntry(mount="wall", voltage_v=120, default_load_w=180.0),
    DeviceType.OUTLET_GFCI: DeviceCatalogEntry(mount="wall", voltage_v=120, default_load_w=180.0),
    DeviceType.SWITCH: DeviceCatalogEntry(mount="wall", voltage_v=None, default_load_w=0.0),
    DeviceType.SWITCH_3WAY: DeviceCatalogEntry(mount="wall", voltage_v=None, default_load_w=0.0),
    DeviceType.CEILING_LIGHT: DeviceCatalogEntry(
        mount="ceiling", voltage_v=120, default_load_w=15.0
    ),
    DeviceType.WALL_LIGHT: DeviceCatalogEntry(mount="wall", voltage_v=120, default_load_w=15.0),
    DeviceType.BASEBOARD_HEATER: DeviceCatalogEntry(
        mount="wall",
        voltage_v=240,
        default_load_w=1000.0,
        footprint=DeviceFootprint(along_in=36.0, across_in=3.0),
    ),
    DeviceType.THERMOSTAT: DeviceCatalogEntry(mount="wall", voltage_v=240, default_load_w=0.0),
    DeviceType.WATER_HEATER: DeviceCatalogEntry(
        mount="free",
        voltage_v=240,
        default_load_w=3800.0,
        footprint=DeviceFootprint(along_in=22.0, across_in=22.0),
    ),
    DeviceType.AIR_EXCHANGER: DeviceCatalogEntry(
        mount="free",
        voltage_v=120,
        default_load_w=150.0,
        footprint=DeviceFootprint(along_in=30.0, across_in=20.0),
    ),
    DeviceType.CENTRAL_VACUUM: DeviceCatalogEntry(
        mount="free",
        voltage_v=120,
        default_load_w=1400.0,
        footprint=DeviceFootprint(along_in=14.0, across_in=14.0),
    ),
    DeviceType.VACUUM_INLET: DeviceCatalogEntry(mount="wall", voltage_v=None, default_load_w=0.0),
    DeviceType.SMOKE_DETECTOR: DeviceCatalogEntry(
        mount="ceiling", voltage_v=120, default_load_w=5.0
    ),
    DeviceType.NETWORK_JACK: DeviceCatalogEntry(mount="wall", voltage_v=None, default_load_w=0.0),
    DeviceType.PANEL: DeviceCatalogEntry(
        mount="wall",
        voltage_v=None,
        default_load_w=0.0,
        footprint=DeviceFootprint(along_in=14.0, across_in=4.0),
    ),
}
