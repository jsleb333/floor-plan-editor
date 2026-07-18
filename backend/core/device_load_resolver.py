"""Resolution of effective device loads and voltages."""

from backend.models.device import Device
from backend.models.device_type import DEVICE_CATALOG


class DeviceLoadResolver:
    """Resolves the effective electrical load and voltage of a placed device.

    Role:
        Single source of truth for the load-resolution precedence used by
        circuit load tracking (spec C4): a per-device override wins over the
        plan-level catalog default (spec section 5.9 tier 2), which wins over
        the built-in catalog default (spec section 5.4). Stateless and pure;
        provided by the container so validation services can share one
        implementation.
    """

    @staticmethod
    def resolve(device: Device, catalog_defaults: dict[str, float]) -> float:
        """Resolve the effective load of a device in watts.

        Args:
            device: The placed device, whose ``load_w`` is the per-instance
                override (``None`` means no override).
            catalog_defaults: Plan-level per-type default loads keyed by
                device type value (spec section 5.9 tier 2); empty means pure
                catalog defaults.

        Returns:
            The device override when set, else the plan-level default for its
            type when present, else the built-in catalog default load.
        """
        if device.load_w is not None:
            return device.load_w
        plan_default = catalog_defaults.get(device.type.value)
        if plan_default is not None:
            return plan_default
        return DEVICE_CATALOG[device.type].default_load_w

    @staticmethod
    def voltage(device: Device) -> int | None:
        """Return the nominal voltage of a device from the catalog.

        Args:
            device: The placed device.

        Returns:
            The catalog voltage in volts, or ``None`` for no-load
            control/data device types.
        """
        return DEVICE_CATALOG[device.type].voltage_v
