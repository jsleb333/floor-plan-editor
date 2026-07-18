"""Control link domain model."""

from typing import Literal

from pydantic import BaseModel


class ControlLink(BaseModel):
    """A documentary link from a switch to what it controls (spec D6).

    Role:
        Records that a switch controls a light (``controls``) or that two
        3-way switches are paired (``three_way_pair``). Purely documentary:
        rendered as a dashed arc on hover, it has no electrical-load impact and
        does not affect circuit connectivity or validation.
    """

    id: str
    switch_id: str
    target_id: str
    kind: Literal["controls", "three_way_pair"] = "controls"
