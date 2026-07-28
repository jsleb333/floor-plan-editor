"""Tests for the PlanDocument model, focused on the preset_lists and guides fields."""

from backend.constants import DOOR_WIDTH_PRESET_LIST_NAME
from backend.models.free_guide import FreeGuide
from backend.models.plan_document import PlanDocument
from backend.models.point import Point
from backend.models.point_guide import PointGuide
from backend.models.surface_guide import SurfaceGuide
from backend.models.wall_end_ref import WallEndRef


class TestPlanDocument:
    def test_preset_lists__when_document_is_fresh__defaults_to_empty(self) -> None:
        """An absent key means "use the built-in defaults"; a fresh document sets none."""
        document = PlanDocument()

        assert document.preset_lists == {}

    def test_preset_lists__when_set_and_dumped__roundtrips_through_validation(self) -> None:
        """A plan-grown preset list survives a dump/validate cycle unchanged."""
        document = PlanDocument(preset_lists={DOOR_WIDTH_PRESET_LIST_NAME: [24.0, 30.0, 54.0]})

        dumped = document.model_dump(mode="json")

        assert dumped["preset_lists"] == {DOOR_WIDTH_PRESET_LIST_NAME: [24.0, 30.0, 54.0]}
        assert PlanDocument.model_validate(dumped) == document

    def test_guides__when_one_of_each_kind_is_stored__roundtrips_through_validation(self) -> None:
        """The guide union discriminates on kind, so the surface-anchored, point-anchored and free forms of an S9 guide all come back as the model they were dumped from."""
        document = PlanDocument(
            guides=[
                SurfaceGuide(
                    id="guide-surface",
                    wall_id="wall-1",
                    segment_index=2,
                    side="left",
                    offset_in=36.0,
                ),
                PointGuide(
                    id="guide-point",
                    anchor=WallEndRef(wall_id="wall-1", end="end"),
                    angle_deg=45.0,
                ),
                FreeGuide(id="guide-free", origin=Point(x=12.0, y=-8.0), angle_deg=90.0),
            ]
        )

        dumped = document.model_dump(mode="json")

        assert [guide["kind"] for guide in dumped["guides"]] == ["surface", "point", "free"]
        assert PlanDocument.model_validate(dumped) == document

    def test_preset_lists__when_key_is_absent_from_a_legacy_dump__still_validates(self) -> None:
        """A document dict without the preset_lists key (as older backends stored) still validates, filling in the empty default without a migration step."""
        legacy = PlanDocument().model_dump(mode="json")
        del legacy["preset_lists"]

        document = PlanDocument.model_validate(legacy)

        assert document.preset_lists == {}
