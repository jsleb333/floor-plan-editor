"""Custom guide union type."""

from typing import Annotated

from pydantic import Field

from backend.models.free_guide import FreeGuide
from backend.models.point_guide import PointGuide
from backend.models.surface_guide import SurfaceGuide


type Guide = Annotated[
    SurfaceGuide | PointGuide | FreeGuide,
    Field(discriminator="kind"),
]
"""A user-placed construction line, discriminated by ``kind``.

Surface and point guides are relations — they name the wall geometry they were
measured from, which the editor's constraint solver maintains. Free is the only
kind stored as bare coordinates. See spec S9.
"""
