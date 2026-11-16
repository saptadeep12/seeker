"""FastAPI application entry point."""

import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from . import provider
from .cache import ResultCache, make_cache_key
from .config import EXTENSION_ORIGIN
from .prompt import SYSTEM_PROMPT, build_user_message
from .ratelimit import (
    InvalidInstallToken,
    RateLimitExceeded,
    RequestLimiter,
    validate_install_token,
)
from .schema import ResolveRequest, ResolveResult
from .stream_parse import MeaningParser, StreamParseError

logger = logging.getLogger("seeker.backend")
app = FastAPI(title="Seeker Backend")
result_cache = ResultCache()
request_limiter = RequestLimiter()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ]
    + ([EXTENSION_ORIGIN] if EXTENSION_ORIGIN else []),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


class ClientDisconnected(Exception):
    """Raised when the client disconnects during provider streaming."""


async def _close_stream(stream: AsyncIterator[str]) -> None:
    close = getattr(stream, "aclose", None)
    if close is not None:
        await close()


async def _next_chunk(
    stream: AsyncIterator[str], request: Request
) -> str | None:
    next_task = asyncio.create_task(anext(stream))
    disconnect_task = asyncio.create_task(request.is_disconnected())
    done, _ = await asyncio.wait(
        {next_task, disconnect_task},
        return_when=asyncio.FIRST_COMPLETED,
    )
    if disconnect_task in done:
        if disconnect_task.result():
            next_task.cancel()
            await asyncio.gather(next_task, return_exceptions=True)
            await _close_stream(stream)
            raise ClientDisconnected
    else:
        disconnect_task.cancel()
        await asyncio.gather(disconnect_task, return_exceptions=True)
    try:
        return await next_task
    except StopAsyncIteration:
        return None


async def _open_attempt(
    request: ResolveRequest, http_request: Request
) -> tuple[AsyncIterator[str], str | None]:
    stream = provider.call_model(
        SYSTEM_PROMPT,
        build_user_message(request),
        ResolveResult.model_json_schema(),
    )
    try:
        return stream, await _next_chunk(stream, http_request)
    except BaseException:
        await _close_stream(stream)
        raise


def _event(name: str, data: object) -> str:
    return (
        f"event: {name}\n"
        f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
    )


def _error_data(error: Exception) -> dict[str, object]:
    if isinstance(error, provider.ProviderRateLimitError):
        return {
            "code": "provider_rate_limit",
            "message": str(error),
            "retryable": True,
        }
    if isinstance(error, (provider.ProviderTimeoutError, TimeoutError)):
        return {
            "code": "timeout",
            "message": "The lookup timed out.",
            "retryable": True,
        }
    if isinstance(error, (StreamParseError, json.JSONDecodeError, ValidationError)):
        return {
            "code": "malformed_output",
            "message": "The model returned an invalid result.",
            "retryable": False,
        }
    return {
        "code": "provider_error",
        "message": "The lookup provider failed.",
        "retryable": True,
    }


async def _events(
    request: ResolveRequest,
    http_request: Request,
    initial_stream: AsyncIterator[str],
    first_chunk: str | None,
    cache_key: str,
) -> AsyncIterator[str]:
    for attempt in range(2):
        stream: AsyncIterator[str] | None = None
        parser = MeaningParser()
        raw_parts: list[str] = []
        try:
            if attempt == 0:
                stream = initial_stream
                chunk = first_chunk
            else:
                yield _event("reset", {})
                stream, chunk = await _open_attempt(request, http_request)

            while chunk is not None:
                raw_parts.append(chunk)
                for meaning in parser.feed(chunk):
                    if meaning:
                        yield _event("meaning", meaning)
                chunk = await _next_chunk(stream, http_request)

            parser.finish()
            result = ResolveResult.model_validate(json.loads("".join(raw_parts)))
            result_cache.set(cache_key, result)
            yield _event("result", result.model_dump())
            return
        except ClientDisconnected:
            return
        except (provider.ProviderRateLimitError, provider.ProviderTimeoutError,
                StreamParseError, json.JSONDecodeError, ValidationError, TimeoutError) as error:
            if attempt == 0 and not isinstance(
                error, (provider.ProviderRateLimitError, provider.ProviderTimeoutError)
            ):
                continue
            yield _event("error", _error_data(error))
            return
        except asyncio.CancelledError:
            return
        finally:
            if stream is not None:
                await _close_stream(stream)


async def _replay(result: ResolveResult) -> AsyncIterator[str]:
    yield _event("meaning", result.meaning)
    yield _event("result", result.model_dump())


def _request_id(http_request: Request) -> str:
    candidate = http_request.headers.get("X-Request-ID", "")
    if candidate and len(candidate) <= 128 and all(
        char.isalnum() or char in "-_" for char in candidate
    ):
        return candidate
    return uuid.uuid4().hex


async def _logged_events(
    events: AsyncIterator[str],
    request_id: str,
    cache_status: str,
    started_at: float,
) -> AsyncIterator[str]:
    status = 200
    try:
        async for event in events:
            yield event
    except asyncio.CancelledError:
        status = 499
        raise
    finally:
        logger.info(
            "resolve request_id=%s status=%s elapsed_ms=%.1f cache=%s",
            request_id,
            status,
            (time.perf_counter() - started_at) * 1000,
            cache_status,
        )


@app.post("/v1/resolve")
async def resolve_endpoint(request: Request):
    """Stream contextual meaning and the final validated result as SSE."""
    request_id = _request_id(request)
    started_at = time.perf_counter()
    try:
        payload = await request.json()
        resolve_request = ResolveRequest.model_validate(payload)
    except (json.JSONDecodeError, ValidationError, TypeError) as error:
        logger.info(
            "resolve request_id=%s status=400 elapsed_ms=%.1f cache=miss",
            request_id,
            (time.perf_counter() - started_at) * 1000,
        )
        return JSONResponse(
            status_code=400,
            content={
                "code": "invalid_request",
                "message": str(error),
                "retryable": False,
            },
        )

    try:
        install_token = validate_install_token(
            request.headers.get("X-Install-Token")
        )
        request_limiter.check(install_token)
    except InvalidInstallToken as error:
        logger.info(
            "resolve request_id=%s status=400 elapsed_ms=%.1f cache=miss",
            request_id,
            (time.perf_counter() - started_at) * 1000,
        )
        return JSONResponse(
            status_code=400,
            content={
                "code": "invalid_install_token",
                "message": str(error),
                "retryable": False,
            },
        )
    except RateLimitExceeded as error:
        logger.info(
            "resolve request_id=%s status=429 elapsed_ms=%.1f cache=miss",
            request_id,
            (time.perf_counter() - started_at) * 1000,
        )
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(error.retry_after)},
            content={
                "code": "rate_limit",
                "message": "Too many lookups; wait a moment.",
                "retryable": True,
            },
        )

    cache_key = make_cache_key(resolve_request.selection, resolve_request.context)
    cached_result = result_cache.get(cache_key)
    if cached_result is not None:
        return StreamingResponse(
            _logged_events(
                _replay(cached_result),
                request_id,
                "hit",
                started_at,
            ),
            media_type="text/event-stream",
        )

    try:
        stream, first_chunk = await _open_attempt(resolve_request, request)
    except provider.ProviderRateLimitError as error:
        logger.info(
            "resolve request_id=%s status=429 elapsed_ms=%.1f cache=miss",
            request_id,
            (time.perf_counter() - started_at) * 1000,
        )
        return JSONResponse(status_code=429, content=_error_data(error))
    except provider.ProviderTimeoutError as error:
        logger.info(
            "resolve request_id=%s status=504 elapsed_ms=%.1f cache=miss",
            request_id,
            (time.perf_counter() - started_at) * 1000,
        )
        return JSONResponse(status_code=504, content=_error_data(error))
    except ClientDisconnected:
        logger.info(
            "resolve request_id=%s status=499 elapsed_ms=%.1f cache=miss",
            request_id,
            (time.perf_counter() - started_at) * 1000,
        )
        return JSONResponse(status_code=499, content={"code": "client_disconnected"})

    return StreamingResponse(
        _logged_events(
            _events(
                resolve_request,
                request,
                stream,
                first_chunk,
                cache_key,
            ),
            request_id,
            "miss",
            started_at,
        ),
        media_type="text/event-stream",
    )
