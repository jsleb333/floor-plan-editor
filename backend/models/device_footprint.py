"""Device footprint domain model."""

from pydantic import BaseModel


class DeviceFootprint(BaseModel):
    """The true physical size of a device, in inches (spec sections 5.4 and D2).

    Role:
        Describes a device type that occupies real space on the plan instead of
        being a fixed-size symbol: ``along_in`` runs ALONG the host wall (the
        pictogram's local x), ``across_in`` reaches ACROSS, into the room (local
        y). A catalog row carries its type's default footprint and a placed
        ``Device`` may override either dimension; a type with no footprint at
        all is symbolic and draws at the editor's nominal pictogram size.
    """

    along_in: float
    across_in: float
