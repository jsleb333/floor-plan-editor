"""Tests for the Device placement validation rules."""

from typing import Any

import pytest
from backend.models.device import Device
from backend.models.device_attachment import DeviceAttachment
from backend.models.device_type import DeviceType
from backend.models.point import Point
from pydantic import ValidationError


def _attachment() -> DeviceAttachment:
    """Build a valid wall attachment."""
    return DeviceAttachment(wall_id="wall-1", segment_index=0, t=24.0)


def _position() -> Point:
    """Build a valid absolute position."""
    return Point(x=48.0, y=60.0)


class TestDevice:
    def test_validation__when_both_attachment_and_position_are_set__raises(self) -> None:
        """A device cannot be simultaneously wall-hosted and free-placed."""
        with pytest.raises(ValidationError, match="exactly one"):
            Device(
                id="d1",
                type=DeviceType.OUTLET,
                attachment=_attachment(),
                position=_position(),
            )

    def test_validation__when_neither_attachment_nor_position_is_set__raises(self) -> None:
        """A device must be placed somewhere."""
        with pytest.raises(ValidationError, match="exactly one"):
            Device(id="d1", type=DeviceType.OUTLET)

    def test_validation__when_ceiling_type_has_an_attachment__raises(self) -> None:
        """Ceiling-mounted types cannot be hosted on a wall."""
        with pytest.raises(ValidationError, match="ceiling-mounted"):
            Device(id="d1", type=DeviceType.CEILING_LIGHT, attachment=_attachment())

    def test_validation__when_free_type_has_an_attachment__raises(self) -> None:
        """Free-standing types cannot be hosted on a wall."""
        with pytest.raises(ValidationError, match="free-mounted"):
            Device(id="d1", type=DeviceType.WATER_HEATER, attachment=_attachment())

    @pytest.mark.parametrize(
        ("device_type", "placement"),
        [
            (DeviceType.OUTLET, {"attachment": _attachment()}),
            (DeviceType.OUTLET, {"position": _position()}),
            (DeviceType.PANEL, {"position": _position()}),
            (DeviceType.CEILING_LIGHT, {"position": _position()}),
            (DeviceType.WATER_HEATER, {"position": _position()}),
        ],
    )
    def test_validation__when_placement_matches_the_mount__accepts_the_device(
        self, device_type: DeviceType, placement: dict[str, Any]
    ) -> None:
        """Wall types accept either placement (a panel may be free-standing); ceiling and free types accept a position."""
        device = Device(id="d1", type=device_type, **placement)

        assert (device.attachment is None) != (device.position is None)

    def test_validation__when_optional_properties_are_set__roundtrips_them(self) -> None:
        """Per-instance properties (spec D2) survive model validation and serialization."""
        device = Device(
            id="bb-1",
            type=DeviceType.BASEBOARD_HEATER,
            attachment=_attachment(),
            label="Salon",
            load_w=750.0,
            length_in=48.0,
            depth_in=4.0,
            notes="sous la fenêtre",
        )

        dumped = device.model_dump(mode="json")
        assert Device.model_validate(dumped) == device
        assert dumped["type"] == "baseboard_heater"
        assert dumped["depth_in"] == 4.0

    def test_validation__when_footprint_overrides_are_absent__defaults_them_to_none(self) -> None:
        """A device stored before footprint overrides existed needs no migration: both slots default to None, meaning "use the catalog footprint"."""
        device = Device.model_validate({
            "id": "wh-1",
            "type": "water_heater",
            "position": {"x": 48.0, "y": 60.0},
        })

        assert device.length_in is None
        assert device.depth_in is None
