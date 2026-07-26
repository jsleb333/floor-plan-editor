"""Tests for CircuitValidationService connectivity, load and finding computation."""

import json
from pathlib import Path
from typing import Any

import pytest
from backend.core.device_load_resolver import DeviceLoadResolver
from backend.core.services.circuit_validation_service import CircuitValidationService
from backend.models.circuit import Circuit
from backend.models.device import Device
from backend.models.device_attachment import DeviceAttachment
from backend.models.device_type import DeviceType
from backend.models.plan_document import PlanDocument
from backend.models.point import Point
from backend.models.wire import Wire


CIRCUIT_VALIDATION_FIXTURES_DIR = (
    Path(__file__).resolve().parent.parent.parent / "fixtures" / "circuit_validation"
)


def _load_corpus_fixtures() -> list[dict[str, Any]]:
    """Load every scenario in the fixture corpus shared with the frontend mirror.

    Each JSON file under ``tests/fixtures/circuit_validation/`` holds a
    ``{name, description, document, expected}`` scenario asserted identically
    by this suite and by ``frontend/tests/utils/circuitsCorpus.test.ts``, so a
    rule added to only one implementation fails one of the two suites.
    """
    return [
        json.loads(path.read_text())
        for path in sorted(CIRCUIT_VALIDATION_FIXTURES_DIR.glob("*.json"))
    ]


CIRCUIT_VALIDATION_CORPUS = _load_corpus_fixtures()


def _panel(device_id: str = "panel") -> Device:
    """Build a free-standing electrical panel device."""
    return Device(id=device_id, type=DeviceType.PANEL, position=Point(x=0.0, y=0.0))


def _feed(
    device_id: str, device_type: DeviceType = DeviceType.FEED_DOWN, load_w: float | None = None
) -> Device:
    """Build a wall-attached inter-floor circuit feed with an optional load override."""
    return Device(
        id=device_id,
        type=device_type,
        attachment=DeviceAttachment(wall_id="wall-1", segment_index=0, t=6.0),
        load_w=load_w,
    )


def _outlet(device_id: str, load_w: float | None = None) -> Device:
    """Build a wall-attached duplex outlet with an optional load override."""
    return Device(
        id=device_id,
        type=DeviceType.OUTLET,
        attachment=DeviceAttachment(wall_id="wall-1", segment_index=0, t=12.0),
        load_w=load_w,
    )


def _baseboard(device_id: str, load_w: float | None = None) -> Device:
    """Build a wall-attached baseboard heater with an optional load override."""
    return Device(
        id=device_id,
        type=DeviceType.BASEBOARD_HEATER,
        attachment=DeviceAttachment(wall_id="wall-1", segment_index=0, t=24.0),
        load_w=load_w,
    )


def _network_jack(device_id: str) -> Device:
    """Build a wall-attached network jack (data device, no load)."""
    return Device(
        id=device_id,
        type=DeviceType.NETWORK_JACK,
        attachment=DeviceAttachment(wall_id="wall-1", segment_index=0, t=6.0),
    )


def _wire(wire_id: str, circuit_id: str, from_id: str, to_id: str) -> Wire:
    """Build a wire between two devices on a circuit."""
    return Wire(id=wire_id, circuit_id=circuit_id, from_device_id=from_id, to_device_id=to_id)


def _power_circuit(
    circuit_id: str = "circ-1", breaker_a: int = 15, voltage_v: int = 120
) -> Circuit:
    """Build a power circuit with the given breaker and voltage."""
    return Circuit(
        id=circuit_id,
        name="Circuit",
        color="#ff0000",
        breaker_a=breaker_a,
        voltage_v=voltage_v,
        kind="power",
    )


class TestCircuitValidationService:
    @pytest.fixture
    def service(self) -> CircuitValidationService:
        """Service under test, wired to the real load resolver."""
        return CircuitValidationService(DeviceLoadResolver())

    def test_validate__when_chain_reaches_panel__connects_all_and_sums_loads(
        self, service: CircuitValidationService
    ) -> None:
        """A panel -> outlet -> outlet chain connects both outlets; 2x180 W at 120 V is 3.0 A, well under a 15 A breaker."""
        document = PlanDocument(
            devices=[_panel(), _outlet("out-1"), _outlet("out-2")],
            circuits=[_power_circuit()],
            wires=[
                _wire("w-1", "circ-1", "panel", "out-1"),
                _wire("w-2", "circ-1", "out-1", "out-2"),
            ],
        )

        result = service.validate(document)

        assert result.has_source is True
        assert len(result.circuits) == 1
        load = result.circuits[0]
        assert load.connected_device_ids == ["out-1", "out-2"]
        assert load.floating_device_ids == []
        assert load.load_w == 360.0
        assert load.amps == pytest.approx(3.0)
        assert load.status == "ok"

    def test_validate__when_amps_reach_eighty_percent__status_is_warning(
        self, service: CircuitValidationService
    ) -> None:
        """A 2900 W baseboard at 240 V is 12.08 A, at or above the 12.0 A (80 % of 15 A) continuous-load threshold."""
        document = PlanDocument(
            devices=[_panel(), _baseboard("bb-1", load_w=2900.0)],
            circuits=[_power_circuit(voltage_v=240)],
            wires=[_wire("w-1", "circ-1", "panel", "bb-1")],
        )

        load = service.validate(document).circuits[0]

        assert load.amps == pytest.approx(12.0833, abs=1e-3)
        assert load.status == "warning"

    def test_validate__when_amps_exceed_breaker__status_is_over(
        self, service: CircuitValidationService
    ) -> None:
        """A 4000 W baseboard at 240 V is 16.7 A, above the 15 A breaker."""
        document = PlanDocument(
            devices=[_panel(), _baseboard("bb-1", load_w=4000.0)],
            circuits=[_power_circuit(voltage_v=240)],
            wires=[_wire("w-1", "circ-1", "panel", "bb-1")],
        )

        load = service.validate(document).circuits[0]

        assert load.amps == pytest.approx(16.6667, abs=1e-3)
        assert load.status == "over"

    def test_validate__when_devices_wired_without_panel_path__they_float_and_carry_no_load(
        self, service: CircuitValidationService
    ) -> None:
        """An outlet cluster wired together but not to the panel is floating and excluded from the load sum."""
        document = PlanDocument(
            devices=[_panel(), _outlet("out-1"), _outlet("out-2"), _outlet("out-3")],
            circuits=[_power_circuit()],
            wires=[
                _wire("w-1", "circ-1", "panel", "out-1"),
                _wire("w-2", "circ-1", "out-2", "out-3"),
            ],
        )

        load = service.validate(document).circuits[0]

        assert load.connected_device_ids == ["out-1"]
        assert load.floating_device_ids == ["out-2", "out-3"]
        assert load.load_w == 180.0

    def test_validate__when_device_wired_to_two_circuits__it_is_flagged_multi_circuit(
        self, service: CircuitValidationService
    ) -> None:
        """An outlet wired into two circuits violates the one-circuit rule (spec C3) and is reported with both circuit ids."""
        document = PlanDocument(
            devices=[_panel(), _outlet("out-1")],
            circuits=[_power_circuit("circ-1"), _power_circuit("circ-2")],
            wires=[
                _wire("w-1", "circ-1", "panel", "out-1"),
                _wire("w-2", "circ-2", "panel", "out-1"),
            ],
        )

        result = service.validate(document)

        assert result.multi_circuit_device_ids == {"out-1": ["circ-1", "circ-2"]}

    def test_validate__when_wire_references_missing_entities__it_is_dangling(
        self, service: CircuitValidationService
    ) -> None:
        """Wires pointing at a missing device or a missing circuit are reported and excluded from connectivity."""
        document = PlanDocument(
            devices=[_panel(), _outlet("out-1")],
            circuits=[_power_circuit()],
            wires=[
                _wire("w-1", "circ-1", "panel", "out-1"),
                _wire("w-missing-device", "circ-1", "panel", "ghost"),
                _wire("w-missing-circuit", "circ-ghost", "panel", "out-1"),
            ],
        )

        result = service.validate(document)

        assert result.dangling_wire_ids == ["w-missing-circuit", "w-missing-device"]
        assert result.circuits[0].connected_device_ids == ["out-1"]

    def test_validate__when_wires_exist_without_source__has_source_is_false(
        self, service: CircuitValidationService
    ) -> None:
        """A document with wires but no source device reports has_source False; nothing reaches a source so no device connects."""
        document = PlanDocument(
            devices=[_outlet("out-1"), _outlet("out-2")],
            circuits=[_power_circuit()],
            wires=[_wire("w-1", "circ-1", "out-1", "out-2")],
        )

        result = service.validate(document)

        assert result.has_source is False
        assert result.circuits[0].connected_device_ids == []
        assert result.circuits[0].floating_device_ids == ["out-1", "out-2"]
        assert result.circuits[0].load_w == 0.0

    def test_validate__when_the_only_source_is_a_feed__it_roots_the_circuit(
        self, service: CircuitValidationService
    ) -> None:
        """A storey with no panel of its own, fed from below, still connects and sums: the feed is a connectivity root like the panel, and is never itself reported."""
        document = PlanDocument(
            devices=[_feed("feed-1"), _outlet("out-1"), _outlet("out-2")],
            circuits=[_power_circuit()],
            wires=[
                _wire("w-1", "circ-1", "feed-1", "out-1"),
                _wire("w-2", "circ-1", "out-1", "out-2"),
            ],
        )

        result = service.validate(document)

        assert result.has_source is True
        load = result.circuits[0]
        assert load.connected_device_ids == ["out-1", "out-2"]
        assert load.floating_device_ids == []
        assert load.load_w == 360.0

    def test_validate__when_a_feed_carries_a_load_override__it_stays_out_of_the_circuit_sum(
        self, service: CircuitValidationService
    ) -> None:
        """A feed's load_w documents what it draws where it originates; sources never join the connected-device sum, so only the outlet's 180 W is counted here."""
        document = PlanDocument(
            devices=[_feed("feed-1", load_w=3000.0), _outlet("out-1")],
            circuits=[_power_circuit()],
            wires=[_wire("w-1", "circ-1", "feed-1", "out-1")],
        )

        load = service.validate(document).circuits[0]

        assert load.connected_device_ids == ["out-1"]
        assert load.load_w == 180.0

    def test_validate__when_a_feed_is_unwired_or_on_two_circuits__it_is_never_flagged(
        self, service: CircuitValidationService
    ) -> None:
        """Feeds inherit every panel exemption: wiring one into two circuits is no spec C3 violation, and an unwired one is not unassigned."""
        document = PlanDocument(
            devices=[
                _feed("feed-1", load_w=1500.0),
                _feed("feed-lonely", device_type=DeviceType.FEED_UP, load_w=2000.0),
                _outlet("out-1"),
                _outlet("out-2"),
            ],
            circuits=[_power_circuit("circ-1"), _power_circuit("circ-2")],
            wires=[
                _wire("w-1", "circ-1", "feed-1", "out-1"),
                _wire("w-2", "circ-2", "feed-1", "out-2"),
            ],
        )

        result = service.validate(document)

        assert result.multi_circuit_device_ids == {}
        assert result.unassigned_device_ids == []

    def test_validate__when_circuit_is_data__it_carries_no_load(
        self, service: CircuitValidationService
    ) -> None:
        """A data circuit connects its jacks but reports zero watts, no amps and an ok status."""
        data_circuit = Circuit(id="data-1", name="Data", color="#00ff00", kind="data")
        document = PlanDocument(
            devices=[_panel(), _network_jack("nj-1")],
            circuits=[data_circuit],
            wires=[_wire("w-1", "data-1", "panel", "nj-1")],
        )

        load = service.validate(document).circuits[0]

        assert load.connected_device_ids == ["nj-1"]
        assert load.load_w == 0.0
        assert load.amps is None
        assert load.status == "ok"

    def test_validate__when_summing_loads__applies_override_then_plan_then_catalog(
        self, service: CircuitValidationService
    ) -> None:
        """The load sum honours the resolution precedence: an override device (2000 W), a plan-default device (750 W) and a catalog-default outlet (180 W) total 2930 W."""
        document = PlanDocument(
            devices=[
                _panel(),
                _baseboard("bb-override", load_w=2000.0),
                _baseboard("bb-plan-default"),
                _outlet("out-catalog"),
            ],
            circuits=[_power_circuit(breaker_a=30, voltage_v=240)],
            catalog_defaults={"baseboard_heater": 750.0},
            wires=[
                _wire("w-1", "circ-1", "panel", "bb-override"),
                _wire("w-2", "circ-1", "bb-override", "bb-plan-default"),
                _wire("w-3", "circ-1", "bb-plan-default", "out-catalog"),
            ],
        )

        load = service.validate(document).circuits[0]

        assert load.connected_device_ids == ["bb-override", "bb-plan-default", "out-catalog"]
        assert load.load_w == pytest.approx(2930.0)

    def test_validate__when_powered_device_has_no_wires__it_is_unassigned(
        self, service: CircuitValidationService
    ) -> None:
        """A powered outlet with no wires is listed unassigned (spec C5), while a switch (no load) and the panel are not."""
        document = PlanDocument(
            devices=[
                _panel(),
                _outlet("out-wired"),
                _outlet("out-lonely"),
                Device(
                    id="sw-1",
                    type=DeviceType.SWITCH,
                    attachment=DeviceAttachment(wall_id="wall-1", segment_index=0, t=3.0),
                ),
            ],
            circuits=[_power_circuit()],
            wires=[_wire("w-1", "circ-1", "panel", "out-wired")],
        )

        result = service.validate(document)

        assert result.unassigned_device_ids == ["out-lonely"]

    def test_corpus_fixtures__when_discovered_via_glob__is_non_empty(self) -> None:
        """Guards against a bad glob path silently turning the corpus-driven test below into a no-op."""
        assert len(CIRCUIT_VALIDATION_CORPUS) > 0

    @pytest.mark.parametrize(
        "fixture",
        CIRCUIT_VALIDATION_CORPUS,
        ids=[fixture["name"] for fixture in CIRCUIT_VALIDATION_CORPUS],
    )
    def test_validate__against_shared_corpus__matches_expected_result(
        self, service: CircuitValidationService, fixture: dict[str, Any]
    ) -> None:
        """Cross-language contract: every scenario in tests/fixtures/circuit_validation/ must validate identically here and in the frontend `circuitsCorpus.test.ts` mirror."""
        document = PlanDocument.model_validate(fixture["document"])

        result = service.validate(document)

        assert result.model_dump(mode="json") == fixture["expected"]
