"""Orchestrator that installs the bundled demo plan on first run."""

import json
from pathlib import Path

from loguru import logger

from backend.core.services.asset_service import AssetService
from backend.core.services.plan_service import PlanService
from backend.models.plan_document import PlanDocument


DEMO_DIR = Path(__file__).resolve().parents[2] / "demo"
DEMO_DOCUMENT_FILE = "basement_demo.json"
DEMO_PHOTO_FILE = "basement_photo.jpg"
DEMO_PHOTO_CONTENT_TYPE = "image/jpeg"
DEMO_ASSET_PLACEHOLDER = "__DEMO_ASSET__"
DEMO_PLAN_NAME = "Sous-sol (démo)"


class DemoPlanSeeder:
    """Installs the hand-digitized basement demo plan when the store is empty.

    Role:
        First-run showcase seeder (spec section 11, milestone M7). Coordinates
        the asset upload of the bundled tracing photo and the creation of the
        demo plan document so the app ships with a complete, end-to-end example
        the very first time it starts. Being a multi-service coordination step
        it is an orchestrator, invoked only from the application entry point
        (the ``main`` lifespan), never by a service. Seeding is best-effort:
        any failure is logged and swallowed so a broken demo asset can never
        prevent the app from starting.
    """

    def __init__(self, plan_service: PlanService, asset_service: AssetService) -> None:
        """Store the plan and asset services it coordinates.

        Args:
            plan_service: Used to detect an already-populated store, create the
                demo plan and store its digitized document.
            asset_service: Used to upload the bundled tracing photo and obtain
                the asset id referenced by the demo document's underlay.
        """
        self._plan_service = plan_service
        self._asset_service = asset_service

    async def seed_if_empty(self) -> bool:
        """Seed the demo plan when no plan exists yet.

        The store is considered empty only when :meth:`PlanService.list_plans`
        returns nothing (archived plans count, so a user who archived every
        plan is not re-seeded). When empty, the bundled photo is uploaded, its
        fresh asset id replaces the ``__DEMO_ASSET__`` placeholder in the
        digitized document, the document is validated and stored on a newly
        created plan.

        Returns:
            True when a demo plan was created, False when seeding was skipped
            (a plan already exists) or failed (the error is logged, never
            raised, so application startup is never blocked).
        """
        existing = await self._plan_service.list_plans()
        if existing:
            logger.debug("Skipping demo seed; {} plan(s) already present", len(existing))
            return False
        try:
            await self._install_demo_plan()
        except Exception:
            logger.exception("Failed to seed demo plan; continuing without it")
            return False
        return True

    async def _install_demo_plan(self) -> None:
        """Upload the photo, build the document and store it on a new plan."""
        document = await self._build_document()
        plan = await self._plan_service.create_plan(DEMO_PLAN_NAME)
        await self._plan_service.update_document(plan.id, document, plan.revision)
        logger.info(
            "Seeded demo plan '{}' ({}) with {} circuits and {} devices",
            plan.name,
            plan.id,
            len(document.circuits),
            len(document.devices),
        )

    async def _build_document(self) -> PlanDocument:
        """Upload the bundled photo and build the demo document referencing it.

        Returns:
            The validated demo :class:`PlanDocument`, its underlay image
            reference pointing at the freshly uploaded asset.
        """
        raw_document = (DEMO_DIR / DEMO_DOCUMENT_FILE).read_text(encoding="utf-8")
        photo = (DEMO_DIR / DEMO_PHOTO_FILE).read_bytes()
        asset = await self._asset_service.upload(photo, DEMO_PHOTO_CONTENT_TYPE)
        resolved = raw_document.replace(DEMO_ASSET_PLACEHOLDER, asset.id)
        return PlanDocument.model_validate(json.loads(resolved))
