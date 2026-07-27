"""Tests for the Opening model, focused on the door style field (spec S4)."""

import pytest
from backend.models.opening import Opening
from pydantic import ValidationError


def _door(**overrides: object) -> Opening:
    """Build a 32" door centred on the first segment of ``wall-1``."""
    fields: dict[str, object] = {
        "id": "door-1",
        "kind": "door",
        "wall_id": "wall-1",
        "segment_index": 0,
        "t": 60.0,
        "width_in": 32.0,
    }
    fields.update(overrides)
    return Opening.model_validate(fields)


class TestOpening:
    def test_style__when_absent__defaults_to_swing(self) -> None:
        """The field is additive: a document stored before it existed still validates, as a plain hinged door."""
        assert _door().style == "swing"

    @pytest.mark.parametrize(
        "style", ["swing", "double", "sliding", "bifold", "double_bifold", "pocket"]
    )
    def test_style__when_set_and_dumped__roundtrips_through_validation(self, style: str) -> None:
        """Every closet style survives a save/load cycle unchanged."""
        door = _door(style=style, width_in=60.0, hinge="right", swing="out")

        dumped = door.model_dump(mode="json")

        assert dumped["style"] == style
        assert Opening.model_validate(dumped) == door

    def test_style__when_unknown__is_rejected(self) -> None:
        """Only the six drafted styles are accepted."""
        with pytest.raises(ValidationError):
            _door(style="barn")
