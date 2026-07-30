"""Constants shared across backend modules."""

CURRENT_SCHEMA_VERSION = 10
LEGACY_SCHEMA_VERSION = 1
DEFAULT_THICKNESS_PRESETS_IN = (12.0, 4.5, 3.5)
CONTINUOUS_LOAD_FACTOR = 0.8

# Every user-settable colour in a document is a `#rrggbb` string (circuits,
# wall colours); the frontend resolves what an absent colour falls back to.
HEX_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"

# Canonical keys of PlanDocument.preset_lists (spec section 5.9 tier 2). A key
# absent from the dict means "use the built-in defaults for that list"; new
# lists (e.g. baseboard wattage, device sizes) only need a new constant here.
DOOR_WIDTH_PRESET_LIST_NAME = "door_width"
WINDOW_WIDTH_PRESET_LIST_NAME = "window_width"
STAIRS_WIDTH_PRESET_LIST_NAME = "stairs_width"
ASSET_EXTENSIONS_BY_CONTENT_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
}
