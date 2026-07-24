"""Circuit connectivity and load validation."""

from collections import defaultdict, deque
from typing import Literal

from backend.constants import CONTINUOUS_LOAD_FACTOR
from backend.core.device_load_resolver import DeviceLoadResolver
from backend.models.circuit import Circuit
from backend.models.circuit_load import CircuitLoad
from backend.models.device import Device
from backend.models.device_type import DEVICE_CATALOG, DeviceType
from backend.models.plan_document import PlanDocument
from backend.models.plan_validation import PlanValidation
from backend.models.wire import Wire


class CircuitValidationService:
    """Computes circuit loads, connectivity and assignment findings for a plan.

    Role:
        Single source of truth for the electrical validation surfaced by
        ``GET /api/plans/{id}/validation`` (spec C4/C5/W4). For each circuit it
        walks the wire graph from the electrical panel to decide which devices
        are connected versus floating (spec W4), sums the resolved loads of the
        connected devices on power circuits and rates them against the breaker
        (spec C4). It also reports plan-wide findings: powered devices wired to
        nothing (spec C5), devices wired into more than one circuit (spec C3),
        wires referencing a missing device or circuit, and whether a panel
        exists at all (spec C1). Pure and read-only; it never mutates the
        document.
    """

    def __init__(self, load_resolver: DeviceLoadResolver) -> None:
        """Store the load-resolution dependency.

        Args:
            load_resolver: Resolves the effective per-device load in watts,
                applying the override / plan-default / catalog precedence used
                by the per-circuit load sums.
        """
        self._load_resolver = load_resolver

    def validate(self, document: PlanDocument) -> PlanValidation:
        """Validate the electrical layout of a plan document.

        Args:
            document: The plan document to validate, at the current schema
                version (its devices, circuits and wires drive the result).

        Returns:
            The full validation result: per-circuit loads with connected and
            floating devices, the unassigned powered devices, the multi-circuit
            and dangling-wire findings, and whether a panel exists.
        """
        devices_by_id = {device.id: device for device in document.devices}
        circuits_by_id = {circuit.id: circuit for circuit in document.circuits}
        panel_ids = {device.id for device in document.devices if device.type == DeviceType.PANEL}

        valid_wires, dangling_wire_ids = self._split_wires(
            document.wires, devices_by_id, circuits_by_id
        )

        circuit_loads = [
            self._validate_circuit(circuit, valid_wires, devices_by_id, panel_ids, document)
            for circuit in document.circuits
        ]

        return PlanValidation(
            circuits=circuit_loads,
            unassigned_device_ids=self._unassigned_device_ids(document.devices, valid_wires),
            multi_circuit_device_ids=self._multi_circuit_device_ids(valid_wires, panel_ids),
            dangling_wire_ids=dangling_wire_ids,
            has_panel=bool(panel_ids),
        )

    @staticmethod
    def _split_wires(
        wires: list[Wire],
        devices_by_id: dict[str, Device],
        circuits_by_id: dict[str, Circuit],
    ) -> tuple[list[Wire], list[str]]:
        """Partition wires into valid ones and those referencing missing entities.

        Args:
            wires: All wires in the document.
            devices_by_id: Devices keyed by id, for endpoint existence checks.
            circuits_by_id: Circuits keyed by id, for circuit existence checks.

        Returns:
            The wires whose circuit and both endpoints exist, and the sorted
            ids of the wires that reference a missing device or circuit.
        """
        valid: list[Wire] = []
        dangling: list[str] = []
        for wire in wires:
            if (
                wire.circuit_id in circuits_by_id
                and wire.from_device_id in devices_by_id
                and wire.to_device_id in devices_by_id
            ):
                valid.append(wire)
            else:
                dangling.append(wire.id)
        return valid, sorted(dangling)

    def _validate_circuit(
        self,
        circuit: Circuit,
        valid_wires: list[Wire],
        devices_by_id: dict[str, Device],
        panel_ids: set[str],
        document: PlanDocument,
    ) -> CircuitLoad:
        """Compute the connectivity and load of a single circuit.

        Args:
            circuit: The circuit to evaluate.
            valid_wires: The document's non-dangling wires.
            devices_by_id: Devices keyed by id.
            panel_ids: Ids of the panel devices (the connectivity roots).
            document: The document, for the plan-level catalog defaults used in
                load resolution.

        Returns:
            The circuit's load result: summed watts and amps (``None`` for
            data/low-voltage circuits), the status against its breaker, and its
            connected and floating device ids.
        """
        circuit_wires = [wire for wire in valid_wires if wire.circuit_id == circuit.id]
        connected, floating = self._connectivity(circuit_wires, panel_ids)

        if circuit.kind != "power":
            return CircuitLoad(
                circuit_id=circuit.id,
                load_w=0.0,
                amps=None,
                breaker_a=circuit.breaker_a,
                status="ok",
                connected_device_ids=sorted(connected),
                floating_device_ids=sorted(floating),
            )

        load_w = sum(
            self._load_resolver.resolve(devices_by_id[device_id], document.catalog_defaults)
            for device_id in connected
        )
        amps = load_w / circuit.voltage_v
        return CircuitLoad(
            circuit_id=circuit.id,
            load_w=load_w,
            amps=amps,
            breaker_a=circuit.breaker_a,
            status=self._load_status(amps, circuit.breaker_a),
            connected_device_ids=sorted(connected),
            floating_device_ids=sorted(floating),
        )

    @staticmethod
    def _connectivity(circuit_wires: list[Wire], panel_ids: set[str]) -> tuple[set[str], set[str]]:
        """Split a circuit's wired devices into connected and floating sets.

        Builds the undirected device graph of the circuit's wires and marks a
        device connected when a path of those wires reaches a panel device
        (spec W4); devices wired on the circuit but with no such path are
        floating. Panel devices are the roots and appear in neither set.

        Args:
            circuit_wires: The valid wires belonging to this circuit.
            panel_ids: Ids of the panel devices.

        Returns:
            The connected (panel-reachable, non-panel) device ids and the
            floating (unreachable, non-panel) device ids.
        """
        adjacency: dict[str, set[str]] = defaultdict(set)
        wired_ids: set[str] = set()
        for wire in circuit_wires:
            adjacency[wire.from_device_id].add(wire.to_device_id)
            adjacency[wire.to_device_id].add(wire.from_device_id)
            wired_ids.add(wire.from_device_id)
            wired_ids.add(wire.to_device_id)

        reachable: set[str] = set()
        queue: deque[str] = deque(panel_ids & wired_ids)
        reachable.update(queue)
        while queue:
            current = queue.popleft()
            for neighbour in adjacency[current]:
                if neighbour not in reachable:
                    reachable.add(neighbour)
                    queue.append(neighbour)

        connected = reachable - panel_ids
        floating = wired_ids - reachable - panel_ids
        return connected, floating

    @staticmethod
    def _load_status(amps: float, breaker_a: int) -> Literal["ok", "warning", "over"]:
        """Rate an amperage against a breaker rating (spec C4).

        Args:
            amps: The circuit's computed amperage.
            breaker_a: The breaker rating in amperes.

        Returns:
            ``over`` above 100 % of the breaker, ``warning`` at or above the
            80 % continuous-load threshold, otherwise ``ok``.
        """
        if amps > breaker_a:
            return "over"
        if amps >= CONTINUOUS_LOAD_FACTOR * breaker_a:
            return "warning"
        return "ok"

    @staticmethod
    def _unassigned_device_ids(devices: list[Device], valid_wires: list[Wire]) -> list[str]:
        """List powered devices that no wire connects to (spec C5, informational).

        Args:
            devices: All devices in the document.
            valid_wires: The document's non-dangling wires.

        Returns:
            The sorted ids of load-bearing device types (a positive catalog
            default load or a defined voltage), excluding the panel, that
            appear in no wire at all.
        """
        wired_ids: set[str] = set()
        for wire in valid_wires:
            wired_ids.add(wire.from_device_id)
            wired_ids.add(wire.to_device_id)
        unassigned: list[str] = []
        for device in devices:
            if device.type == DeviceType.PANEL or device.id in wired_ids:
                continue
            entry = DEVICE_CATALOG[device.type]
            if entry.default_load_w > 0 or entry.voltage_v is not None:
                unassigned.append(device.id)
        return sorted(unassigned)

    @staticmethod
    def _multi_circuit_device_ids(
        valid_wires: list[Wire], panel_ids: set[str]
    ) -> dict[str, list[str]]:
        """Find devices wired into more than one circuit (spec C3 violation).

        Args:
            valid_wires: The document's non-dangling wires.
            panel_ids: Ids of the panel devices, excluded because the panel
                feeds every circuit by design.

        Returns:
            A mapping of each offending device id to the sorted list of circuit
            ids it is wired to; empty when every non-panel device is on at most
            one circuit.
        """
        circuits_by_device: dict[str, set[str]] = defaultdict(set)
        for wire in valid_wires:
            for device_id in (wire.from_device_id, wire.to_device_id):
                if device_id not in panel_ids:
                    circuits_by_device[device_id].add(wire.circuit_id)
        return {
            device_id: sorted(circuit_ids)
            for device_id, circuit_ids in sorted(circuits_by_device.items())
            if len(circuit_ids) > 1
        }
