"""Plan document domain model."""

from pydantic import BaseModel, Field

from backend.constants import CURRENT_SCHEMA_VERSION, DEFAULT_THICKNESS_PRESETS_IN
from backend.models.circuit import Circuit
from backend.models.control_link import ControlLink
from backend.models.device import Device
from backend.models.dimension import Dimension
from backend.models.label import Label
from backend.models.opening import Opening
from backend.models.point import Point
from backend.models.stairs import Stairs
from backend.models.underlay import Underlay
from backend.models.viewport import Viewport
from backend.models.wall import Wall
from backend.models.wire import Wire


class PlanDocument(BaseModel):
    """The versioned JSON document holding everything a plan contains.

    Role:
        Unit of persistence and autosave. Schema version 5 carries the
        viewport, the optional tracing underlay, the structure element
        collections (walls, openings, stairs, labels, dimensions), the
        electrical devices with their plan-level default loads
        (``catalog_defaults``, keyed by device type value, spec section 5.9
        tier 2; empty means pure catalog defaults), the plan-level wall
        thickness presets (spec section 5.9 tier 2, ordered [exterior,
        interior alternative, interior default]) and the electrical layout:
        the colour-coded ``circuits``, the ``wires`` connecting devices into
        them (spec section 5.6) and the documentary switch ``control_links``
        (spec D6). Older documents are migrated forward on read by
        :class:`backend.core.plan_migrator.PlanMigrator`; incoming documents
        with an older shape still validate because every field added since
        v1 has a default.
    """

    schema_version: int = CURRENT_SCHEMA_VERSION
    viewport: Viewport = Field(
        default_factory=lambda: Viewport(center=Point(x=0.0, y=0.0), zoom=1.0)
    )
    underlay: Underlay | None = None
    walls: list[Wall] = Field(default_factory=list)
    openings: list[Opening] = Field(default_factory=list)
    stairs: list[Stairs] = Field(default_factory=list)
    labels: list[Label] = Field(default_factory=list)
    dimensions: list[Dimension] = Field(default_factory=list)
    devices: list[Device] = Field(default_factory=list)
    catalog_defaults: dict[str, float] = Field(default_factory=dict)
    thickness_presets_in: list[float] = Field(
        default_factory=lambda: list(DEFAULT_THICKNESS_PRESETS_IN)
    )
    circuits: list[Circuit] = Field(default_factory=list)
    wires: list[Wire] = Field(default_factory=list)
    control_links: list[ControlLink] = Field(default_factory=list)
