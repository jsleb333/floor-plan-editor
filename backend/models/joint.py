"""Wall joint union type."""

from typing import Annotated

from pydantic import Field

from backend.models.corner_joint import CornerJoint
from backend.models.flush_joint import FlushJoint
from backend.models.tee_joint import TeeJoint


type Joint = Annotated[
    CornerJoint | TeeJoint | FlushJoint,
    Field(discriminator="kind"),
]
"""A stored relation between walls, discriminated by ``kind``.

Corner and tee are topology — they assert coincidence, which the editor's
constraint solver maintains. Flush is the only kind that may offset a spine.
See ``docs/WALL_NETWORK.md`` for the resolution rules.
"""
