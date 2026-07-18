"""Tests for DeviceLoadResolver precedence and voltage lookup."""

import pytest
from backend.core.device_load_resolver import DeviceLoadResolver
from backend.models.device import Device
from backend.models.device_attachment import DeviceAttachment
from backend.models.device_type import DeviceType


def _baseboard(load_w: float | None = None) -> Device:
    """Build a wall-attached baseboard heater with an optional load override."""
    return Device(
        id="bb-1",
        type=DeviceType.BASEBOARD_HEATER,
        attachment=DeviceAttachment(wall_id="wall-1", segment_index=0, t=12.0),
        load_w=load_w,
    )


class TestDeviceLoadResolver:
    @pytest.fixture
    def resolver(self) -> DeviceLoadResolver:
        """Resolver under test."""
        return DeviceLoadResolver()

    def test_resolve__when_device_has_an_override__override_wins_over_all_defaults(
        self, resolver: DeviceLoadResolver
    ) -> None:
        """The per-device override beats both the plan-level and catalog defaults."""
        load = resolver.resolve(_baseboard(load_w=1500.0), {"baseboard_heater": 750.0})

        assert load == 1500.0

    def test_resolve__when_plan_has_a_type_default__plan_default_wins_over_catalog(
        self, resolver: DeviceLoadResolver
    ) -> None:
        """Without an override, the plan-level catalog default (spec 5.9 tier 2) applies."""
        load = resolver.resolve(_baseboard(), {"baseboard_heater": 750.0})

        assert load == 750.0

    def test_resolve__when_no_override_or_plan_default__falls_back_to_the_catalog(
        self, resolver: DeviceLoadResolver
    ) -> None:
        """The built-in catalog default (spec 5.4) is the last resort."""
        load = resolver.resolve(_baseboard(), {})

        assert load == 1000.0

    def test_resolve__when_plan_defaults_cover_other_types__they_do_not_apply(
        self, resolver: DeviceLoadResolver
    ) -> None:
        """A plan default for another device type does not leak onto this one."""
        load = resolver.resolve(_baseboard(), {"outlet": 360.0})

        assert load == 1000.0

    def test_voltage__when_type_carries_a_load__returns_the_catalog_voltage(
        self, resolver: DeviceLoadResolver
    ) -> None:
        assert resolver.voltage(_baseboard()) == 240

    def test_voltage__when_type_is_a_data_device__returns_none(
        self, resolver: DeviceLoadResolver
    ) -> None:
        """No-load control/data devices have no nominal circuit voltage."""
        jack = Device(
            id="nj-1",
            type=DeviceType.NETWORK_JACK,
            attachment=DeviceAttachment(wall_id="wall-1", segment_index=0, t=6.0),
        )

        assert resolver.voltage(jack) is None
