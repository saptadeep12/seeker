"""Prompt, provider, and validation orchestration."""

import json
from collections.abc import AsyncIterator
from typing import Any

from pydantic import ValidationError

from . import provider
from .prompt import SYSTEM_PROMPT, build_user_message
from .schema import ResolveRequest, ResolveResult


class ResolveError(Exception):
    """Raised when the model does not return a valid resolve result."""

    def __init__(self, message: str, *, cause: Exception | None = None) -> None:
        super().__init__(message)
        self.cause = cause


async def _collect(chunks: AsyncIterator[str]) -> str:
    parts: list[str] = []
    async for chunk in chunks:
        parts.append(chunk)
    return "".join(parts)


async def resolve(request: ResolveRequest) -> ResolveResult:
    """Resolve a request, retrying once after malformed or invalid output."""
    user_message = build_user_message(request)
    schema = ResolveResult.model_json_schema()
    last_error: Exception | None = None

    for _attempt in range(2):
        try:
            raw_output = await _collect(
                provider.call_model(SYSTEM_PROMPT, user_message, schema)
            )
            parsed: Any = json.loads(raw_output)
            return ResolveResult.model_validate(parsed)
        except (json.JSONDecodeError, ValidationError, TypeError) as error:
            last_error = error

    raise ResolveError(
        "Model returned invalid JSON after one retry.",
        cause=last_error,
    )
