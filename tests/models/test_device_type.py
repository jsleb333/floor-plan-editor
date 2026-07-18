"""Tests for the device type registry and its catalog entries."""

from backend.models.device_type import DEVICE_CATALOG, DeviceType


class TestDeviceType:
    def test_device_catalog__when_compared_to_the_enum__covers_every_type(self) -> None:
        """Every catalog type has exactly one entry, so lookups can never fail."""
        assert set(DEVICE_CATALOG) == set(DeviceType)
        assert len(DeviceType) == 15

    def test_device_catalog__when_reading_spec_rows__matches_the_spec_values(self) -> None:
        """Spot-check the spec section 5.4 rows most likely to matter for load tracking."""
        baseboard = DEVICE_CATALOG[DeviceType.BASEBOARD_HEATER]
        assert baseboard.default_load_w == 1000.0
        assert baseboard.voltage_v == 240
        assert baseboard.mount == "wall"

        water_heater = DEVICE_CATALOG[DeviceType.WATER_HEATER]
        assert water_heater.default_load_w == 3800.0
        assert water_heater.voltage_v == 240
        assert water_heater.mount == "free"

        outlet = DEVICE_CATALOG[DeviceType.OUTLET]
        assert outlet.default_load_w == 180.0
        assert outlet.voltage_v == 120
        assert outlet.mount == "wall"

        network_jack = DEVICE_CATALOG[DeviceType.NETWORK_JACK]
        assert network_jack.voltage_v is None
        assert network_jack.default_load_w == 0.0

    def test_device_catalog__when_a_type_carries_no_load__its_voltage_matches_its_kind(
        self,
    ) -> None:
        """Control, data and low-voltage devices have no nominal circuit voltage."""
        for no_voltage_type in (
            DeviceType.SWITCH,
            DeviceType.SWITCH_3WAY,
            DeviceType.VACUUM_INLET,
            DeviceType.NETWORK_JACK,
            DeviceType.PANEL,
        ):
            assert DEVICE_CATALOG[no_voltage_type].voltage_v is None
            assert DEVICE_CATALOG[no_voltage_type].default_load_w == 0.0
