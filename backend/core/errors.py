"""Domain exceptions for plan operations.

Grouping the domain exceptions in one module is authorized as an exception
to the one-class-per-file rule.
"""


class PlanNotFoundError(Exception):
    """Raised when an operation targets a plan id that does not exist."""

    def __init__(self, plan_id: str) -> None:
        """Build the error message from the missing plan id.

        Args:
            plan_id: Identifier of the plan that could not be found.
        """
        super().__init__(f"Plan '{plan_id}' not found.")


class RevisionConflictError(Exception):
    """Raised when a document update carries a stale revision (optimistic concurrency)."""

    def __init__(self, plan_id: str, expected_revision: int) -> None:
        """Build the error message from the conflicting revision.

        Args:
            plan_id: Identifier of the plan whose update was rejected.
            expected_revision: Revision the client believed to be current.
        """
        super().__init__(
            f"Plan '{plan_id}' was modified concurrently: "
            f"revision {expected_revision} is no longer current."
        )


class UnsupportedSchemaVersionError(Exception):
    """Raised when a stored document claims a schema version above the current one."""

    def __init__(self, version: int, current_version: int) -> None:
        """Build the error message from the offending version.

        Args:
            version: Schema version found in the stored document.
            current_version: Highest schema version this backend understands.
        """
        super().__init__(
            f"Document schema version {version} is newer than the supported "
            f"version {current_version}; documents are never downgraded."
        )


class InvalidSchemaVersionError(Exception):
    """Raised when a stored document's schema version is present but is not a number."""

    def __init__(self, version: object) -> None:
        """Build the error message from the unreadable version value.

        Args:
            version: Value found under the document's ``schema_version`` key.
        """
        super().__init__(
            f"Document schema version {version!r} is not a number; "
            f"which defaults a document is missing cannot be guessed from it."
        )


class AssetNotFoundError(Exception):
    """Raised when an operation targets an asset id that does not exist."""

    def __init__(self, asset_id: str) -> None:
        """Build the error message from the missing asset id.

        Args:
            asset_id: Identifier of the asset that could not be found.
        """
        super().__init__(f"Asset '{asset_id}' not found.")


class UnsupportedAssetTypeError(Exception):
    """Raised when an uploaded asset has a content type outside the whitelist."""

    def __init__(self, content_type: str, supported: list[str]) -> None:
        """Build the error message from the offending content type.

        Args:
            content_type: Content type of the rejected upload.
            supported: Content types the backend accepts.
        """
        super().__init__(
            f"Asset content type '{content_type}' is not supported; "
            f"accepted types: {', '.join(supported)}."
        )


class AssetTooLargeError(Exception):
    """Raised when an uploaded asset exceeds the configured size limit."""

    def __init__(self, size_bytes: int, max_size_bytes: int) -> None:
        """Build the error message from the offending size.

        Args:
            size_bytes: Size of the rejected upload.
            max_size_bytes: Largest accepted asset size.
        """
        super().__init__(
            f"Asset of {size_bytes} bytes exceeds the maximum allowed "
            f"size of {max_size_bytes} bytes."
        )


class PlanNotArchivedError(Exception):
    """Raised when a permanent delete targets a plan that is not archived."""

    def __init__(self, plan_id: str) -> None:
        """Build the error message from the offending plan id.

        Args:
            plan_id: Identifier of the plan that must be archived first.
        """
        super().__init__(f"Plan '{plan_id}' must be archived before permanent deletion.")
