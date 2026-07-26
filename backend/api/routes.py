"""HTTP routes for plan management."""

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, status

from backend.api.schemas import (
    PlanCreateRequest,
    PlanDocumentUpdateRequest,
    PlanMetadataUpdateRequest,
    RevisionResponse,
)
from backend.core.services.circuit_validation_service import CircuitValidationService
from backend.core.services.plan_service import PlanService
from backend.models.plan import Plan
from backend.models.plan_summary import PlanSummary
from backend.models.plan_validation import PlanValidation


router = APIRouter(route_class=DishkaRoute, tags=["plans"])


@router.get("/plans")
async def list_plans(service: FromDishka[PlanService]) -> list[PlanSummary]:
    """List summaries of all plans."""
    return await service.list_plans()


@router.post("/plans", status_code=status.HTTP_201_CREATED)
async def create_plan(body: PlanCreateRequest, service: FromDishka[PlanService]) -> Plan:
    """Create a new plan, optionally seeded with a description, an underlay and settings."""
    return await service.create_plan(
        body.name,
        description=body.description,
        underlay_asset_id=body.underlay_asset_id,
        thickness_presets_in=body.thickness_presets_in,
        display_precision_in=body.display_precision_in,
    )


@router.get("/plans/{plan_id}")
async def get_plan(plan_id: str, service: FromDishka[PlanService]) -> Plan:
    """Fetch a full plan document."""
    return await service.get_plan(plan_id)


@router.put("/plans/{plan_id}")
async def update_plan_document(
    plan_id: str, body: PlanDocumentUpdateRequest, service: FromDishka[PlanService]
) -> RevisionResponse:
    """Replace a plan's document (autosave), guarded by its revision."""
    revision = await service.update_document(plan_id, body.document, body.revision)
    return RevisionResponse(revision=revision)


@router.get("/plans/{plan_id}/validation")
async def get_plan_validation(
    plan_id: str,
    service: FromDishka[PlanService],
    validator: FromDishka[CircuitValidationService],
) -> PlanValidation:
    """Compute the circuit loads, connectivity and assignment findings of a plan."""
    plan = await service.get_plan(plan_id)
    return validator.validate(plan.document)


@router.patch("/plans/{plan_id}")
async def update_plan_metadata(
    plan_id: str, body: PlanMetadataUpdateRequest, service: FromDishka[PlanService]
) -> Plan:
    """Update a plan's metadata (name and/or description); omitted fields are kept."""
    return await service.update_metadata(plan_id, name=body.name, description=body.description)


@router.post("/plans/{plan_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_plan(plan_id: str, service: FromDishka[PlanService]) -> Plan:
    """Duplicate a plan with a fresh identity and the same document."""
    return await service.duplicate_plan(plan_id)


@router.post("/plans/{plan_id}/archive")
async def archive_plan(plan_id: str, service: FromDishka[PlanService]) -> Plan:
    """Soft-delete a plan by marking it archived."""
    return await service.archive_plan(plan_id)


@router.post("/plans/{plan_id}/restore")
async def restore_plan(plan_id: str, service: FromDishka[PlanService]) -> Plan:
    """Restore an archived plan."""
    return await service.restore_plan(plan_id)


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan(plan_id: str, service: FromDishka[PlanService]) -> None:
    """Permanently delete an archived plan."""
    await service.delete_plan_permanently(plan_id)
