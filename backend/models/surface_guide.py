"""Surface-anchored guide domain model."""

from typing import Literal

from pydantic import BaseModel, Field


class SurfaceGuide(BaseModel):
    """A guide line parallel to one wall surface, at a perpendicular offset.

    Role:
        The anchored case of the tape-measure tool (spec S9): what is stored
        is the surface the measurement started from and the offset, never the
        resulting line, so the editor's constraint solver
        (``docs/WALL_NETWORK.md``) keeps the guide true when the wall moves or
        changes thickness. ``side`` names the surface relative to the wall's
        drawing direction, exactly like ``Wall.reference``.
    """

    kind: Literal["surface"] = "surface"
    id: str
    wall_id: str
    segment_index: int = Field(ge=0)
    side: Literal["left", "right"]
    offset_in: float
