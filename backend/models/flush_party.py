"""Flush joint party domain model."""

from typing import Literal

from pydantic import BaseModel

from backend.models.wall_body_ref import WallBodyRef
from backend.models.wall_end_ref import WallEndRef


class FlushParty(BaseModel):
    """One side of a flush relation: a wall end or body, and which surface is shared.

    Role:
        Says WHICH of a wall's two surfaces takes part in a shared-surface
        relation (spec S1b). ``side`` is named relative to the wall's drawing
        direction, exactly like ``Wall.reference``.
    """

    ref: WallEndRef | WallBodyRef
    side: Literal["left", "right"]
