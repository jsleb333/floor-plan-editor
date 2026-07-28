"""Plan document domain model."""

from pydantic import BaseModel, Field

from backend.constants import CURRENT_SCHEMA_VERSION, DEFAULT_THICKNESS_PRESETS_IN
from backend.models.circuit import Circuit
from backend.models.control_link import ControlLink
from backend.models.device import Device
from backend.models.dimension import Dimension
from backend.models.guide import Guide
from backend.models.joint import Joint
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
        Unit of persistence and autosave. Schema version 9 carries the
        viewport, the optional tracing underlay, the structure element
        collections (walls, openings, stairs, labels, dimensions), the
        electrical devices with their plan-level default loads
        (``catalog_defaults``, keyed by device type value, spec section 5.9
        tier 2; empty means pure catalog defaults), the plan-level wall
        thickness presets (spec section 5.9 tier 2, ordered [exterior,
        interior alternative, interior default]), the per-plan display
        precision override ``display_precision_in`` (spec section 5.9 tier
        2; None falls back to the tier-1 app preference), the per-plan
        ``preset_lists`` (spec section 5.9 tier 2; user-grown option buttons
        for tools such as door/window/stairs width, keyed by a canonical name
        from ``backend.constants`` — e.g. ``door_width`` — a key absent from
        the dict means "use that list's built-in defaults", so new preset
        lists never require a schema change), the electrical
        layout — the colour-coded ``circuits``, the ``wires`` connecting
        devices into them (spec section 5.6) and the documentary switch
        ``control_links`` (spec D6), the wall ``joints`` recording how walls
        connect (spec S1b/S3a, new in v8; an empty list on a plan that has
        walls means "connectivity not derived yet" and the editor rebuilds it
        from geometry) — and the ``active_tool`` last armed in
        the editor, so a session restores where it left off (spec P4/E9;
        the frontend owns the valid tool ids and falls back to Select on
        unknown values). The tape-measure tool's ``guides`` (spec S9, new in
        v9) are working geometry the user placed deliberately: surface- and
        point-anchored ones store a relation the constraint solver maintains,
        free ones store bare coordinates. Older documents are migrated forward
        on read by
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
    joints: list[Joint] = Field(default_factory=list)
    guides: list[Guide] = Field(default_factory=list)
    openings: list[Opening] = Field(default_factory=list)
    stairs: list[Stairs] = Field(default_factory=list)
    labels: list[Label] = Field(default_factory=list)
    dimensions: list[Dimension] = Field(default_factory=list)
    devices: list[Device] = Field(default_factory=list)
    catalog_defaults: dict[str, float] = Field(default_factory=dict)
    thickness_presets_in: list[float] = Field(
        default_factory=lambda: list(DEFAULT_THICKNESS_PRESETS_IN)
    )
    display_precision_in: float | None = None
    preset_lists: dict[str, list[float]] = Field(default_factory=dict)
    circuits: list[Circuit] = Field(default_factory=list)
    wires: list[Wire] = Field(default_factory=list)
    control_links: list[ControlLink] = Field(default_factory=list)
    active_tool: str | None = None
