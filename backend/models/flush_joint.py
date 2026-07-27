"""Flush joint domain model."""

from typing import Literal

from pydantic import BaseModel

from backend.models.flush_party import FlushParty


class FlushJoint(BaseModel):
    """A declaration that two wall surfaces are ONE surface.

    Role:
        What makes walls of unequal thickness read as a single wall (spec
        S1b): the parties' spines sit parallel and offset by half the
        thickness difference, so the shared surfaces are collinear and the
        whole difference steps off the other side. The only joint kind whose
        constraint may move a stored spine.
    """

    kind: Literal["flush"] = "flush"
    id: str
    a: FlushParty
    b: FlushParty
