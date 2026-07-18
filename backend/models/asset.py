"""Asset metadata domain model."""

from datetime import datetime

from pydantic import BaseModel


class Asset(BaseModel):
    """Metadata of an uploaded binary asset (underlay image).

    Role:
        Identifies a server-stored file and describes it for clients: the
        ``id`` is what plan documents reference (``Underlay.image_ref``) and
        what ``GET /api/assets/{id}`` serves. Assets are immutable once
        uploaded — they are never modified, only referenced.
    """

    id: str
    content_type: str
    size_bytes: int
    created_at: datetime
