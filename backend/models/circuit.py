"""Circuit domain model."""

from typing import Literal

from pydantic import BaseModel, Field


HEX_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"


class Circuit(BaseModel):
    """A named, colour-coded group of devices protected by one breaker (spec C1/C2).

    Role:
        The circuit identity on the canvas: its ``color`` (a ``#rrggbb`` hex
        string, the circuit's identity per spec C2), the breaker rating in
        amperes and nominal voltage that bound its load (spec C4), and its
        ``kind`` — ``power`` circuits carry electrical load, while ``data`` and
        ``low_voltage`` pseudo-circuits carry none and have no breaker meaning
        (spec C3). Devices join a circuit only by being wired into it
        (:class:`backend.models.wire.Wire`); a circuit stores no device list.
    """

    id: str
    name: str
    color: str = Field(pattern=HEX_COLOR_PATTERN)
    breaker_a: int = Field(default=15, gt=0)
    voltage_v: Literal[120, 240] = 120
    kind: Literal["power", "data", "low_voltage"] = "power"
