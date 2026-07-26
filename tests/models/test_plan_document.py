"""Tests for the PlanDocument model, focused on the per-plan preset_lists field."""

from backend.constants import DOOR_WIDTH_PRESET_LIST_NAME
from backend.models.plan_document import PlanDocument


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

    def test_preset_lists__when_key_is_absent_from_a_legacy_dump__still_validates(self) -> None:
        """A document dict without the preset_lists key (as older backends stored) still validates, filling in the empty default without a migration step."""
        legacy = PlanDocument().model_dump(mode="json")
        del legacy["preset_lists"]

        document = PlanDocument.model_validate(legacy)

        assert document.preset_lists == {}
