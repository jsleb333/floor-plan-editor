"""Corner joint domain model."""

from typing import Literal

from pydantic import BaseModel, Field

from backend.models.wall_end_ref import WallEndRef


class CornerJoint(BaseModel):
    """Wall ends whose spines meet at one point.

    Role:
        The mitre relation (spec S1b). Two or more ends may meet, and the
        faces resolve pairwise in angular order, so an L-corner, a three-way
        meeting and a chain split across separate walls are one case. ``rule``
        ``square`` suppresses the mitre and caps both ends instead.
    """

    kind: Literal["corner"] = "corner"
    id: str
    ends: list[WallEndRef] = Field(min_length=2)
    rule: Literal["miter", "square"] = "miter"
