"""Plan-wide circuit validation result model."""

from pydantic import BaseModel, Field

from backend.models.circuit_load import CircuitLoad


class PlanValidation(BaseModel):
    """The full circuit validation result for a plan (spec C4/C5/W4, API section 9).

    Role:
        Read-only payload returned by ``GET /api/plans/{id}/validation``,
        computed by
        :class:`backend.core.services.circuit_validation_service.CircuitValidationService`.
        Carries the per-circuit loads (:class:`CircuitLoad`), the powered
        devices wired to nothing (``unassigned_device_ids``, spec C5,
        informational), the devices wired into more than one circuit in
        violation of spec C3 (``multi_circuit_device_ids`` maps each such
        device id to the circuit ids it is wired to), the wires referencing a
        missing device or circuit (``dangling_wire_ids``) and whether the plan
        has any connectivity root at all (``has_source``; spec C1 expects at
        least one — the electrical panel, or a feed from another floor). All
        lists are sorted for deterministic output.
    """

    circuits: list[CircuitLoad] = Field(default_factory=list)
    unassigned_device_ids: list[str] = Field(default_factory=list)
    multi_circuit_device_ids: dict[str, list[str]] = Field(default_factory=dict)
    dangling_wire_ids: list[str] = Field(default_factory=list)
    has_source: bool = False
