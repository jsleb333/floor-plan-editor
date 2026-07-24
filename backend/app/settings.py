"""Application configuration loaded from environment variables."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    """Runtime configuration for the floor plan editor backend.

    Role:
        Single source of configuration, loaded from environment variables
        prefixed with ``FLOORPLAN_``. Injected by the container into any
        component that needs paths or tunables.
    """

    model_config = SettingsConfigDict(env_prefix="FLOORPLAN_")

    data_dir: Path = Path("data")
    db_path: Path = Path("data") / "floor_plan.db"
    frontend_dist: Path = Path("frontend") / "dist"
    max_asset_size_bytes: int = 30 * 1024 * 1024
    seed_demo_plan: bool = True
