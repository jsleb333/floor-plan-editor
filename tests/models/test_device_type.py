"""Tests for the device type registry and its catalog entries."""

from backend.models.device_type import DEVICE_CATALOG, DeviceType


class TestDeviceType:
    def test_device_catalog__when_compared_to_the_enum__covers_every_type(self) -> None:
        """Every catalog type has exactly one entry, so lookups can never fail."""
        assert set(DEVICE_CATALOG) == set(DeviceType)
        assert len(DeviceType) == 17

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

        for feed_type in (DeviceType.FEED_UP, DeviceType.FEED_DOWN):
            feed = DEVICE_CATALOG[feed_type]
            assert feed.mount == "wall"
            assert feed.voltage_v is None
            assert feed.default_load_w == 0.0

    def test_device_catalog__when_a_type_has_a_real_size__carries_its_default_footprint(
        self,
    ) -> None:
        """The physically sized types carry an along/across footprint in inches (spec D2); the baseboard row keeps the editor's historical 36" x 3" default."""
        expected_footprints = {
            DeviceType.BASEBOARD_HEATER: (36.0, 3.0),
            DeviceType.WATER_HEATER: (22.0, 22.0),
            DeviceType.CENTRAL_VACUUM: (14.0, 14.0),
            DeviceType.AIR_EXCHANGER: (30.0, 20.0),
            DeviceType.PANEL: (14.0, 4.0),
        }
        for device_type, (along_in, across_in) in expected_footprints.items():
            footprint = DEVICE_CATALOG[device_type].footprint
            assert footprint is not None
            assert (footprint.along_in, footprint.across_in) == (along_in, across_in)

    def test_device_catalog__when_a_type_is_symbolic__carries_no_footprint(self) -> None:
        """Every other type has no real size and draws at the editor's nominal pictogram size."""
        sized = {
            DeviceType.BASEBOARD_HEATER,
            DeviceType.WATER_HEATER,
            DeviceType.CENTRAL_VACUUM,
            DeviceType.AIR_EXCHANGER,
            DeviceType.PANEL,
        }
        for device_type in DeviceType:
            if device_type in sized:
                continue
            assert DEVICE_CATALOG[device_type].footprint is None

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
            DeviceType.FEED_UP,
            DeviceType.FEED_DOWN,
        ):
            assert DEVICE_CATALOG[no_voltage_type].voltage_v is None
            assert DEVICE_CATALOG[no_voltage_type].default_load_w == 0.0

    def test_device_catalog__when_reading_the_source_role__flags_exactly_the_roots(self) -> None:
        """The connectivity roots (spec C1/W4) are the panel and the two inter-floor feeds; every other type draws from a circuit rather than feeding one."""
        sources = {
            device_type for device_type in DeviceType if DEVICE_CATALOG[device_type].is_source
        }

        assert sources == {DeviceType.PANEL, DeviceType.FEED_UP, DeviceType.FEED_DOWN}
