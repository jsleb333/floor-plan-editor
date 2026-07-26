"""Electrical device domain model."""

from typing import Self

from pydantic import BaseModel, model_validator

from backend.models.device_attachment import DeviceAttachment
from backend.models.device_type import DEVICE_CATALOG, DeviceType
from backend.models.point import Point


class Device(BaseModel):
    """An electrical device placed on the plan (spec sections 5.4 and 8).

    Role:
        One placed pictogram: its type, its placement — either a parametric
        wall ``attachment`` (spec section 4.2) or an absolute ``position``
        for ceiling/free-standing devices, never both — and its per-instance
        properties (spec D2): optional label, notes, load override in watts
        (``None`` means the catalog or plan default applies) and, for the types
        whose catalog row carries a ``DeviceFootprint``, size overrides in
        inches — ``length_in`` ALONG the wall and ``depth_in`` ACROSS, into the
        room. Either left ``None`` falls back to that dimension of the catalog
        footprint; both are meaningless for symbolic types, which draw at the
        editor's nominal pictogram size. Wall-mount types accept either
        placement (a panel may be free-standing); ceiling and free types
        require a position.
    """

    id: str
    type: DeviceType
    attachment: DeviceAttachment | None = None
    position: Point | None = None
    rotation_deg: float = 0.0
    label: str | None = None
    load_w: float | None = None
    length_in: float | None = None
    depth_in: float | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _validate_placement(self) -> Self:
        """Enforce exactly one placement, compatible with the type's mount.

        Returns:
            The validated device.

        Raises:
            ValueError: When both or neither of ``attachment`` and
                ``position`` are set, or when a ceiling/free-mounted type
                carries a wall attachment.
        """
        if (self.attachment is None) == (self.position is None):
            raise ValueError("exactly one of 'attachment' or 'position' must be set")
        mount = DEVICE_CATALOG[self.type].mount
        if self.attachment is not None and mount != "wall":
            raise ValueError(
                f"device type '{self.type}' is {mount}-mounted and cannot have a wall attachment"
            )
        return self
