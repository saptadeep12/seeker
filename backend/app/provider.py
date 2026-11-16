"""The model-specific provider implementation."""

from collections.abc import AsyncIterator

from groq import AsyncGroq

from .config import (
    GROQ_API_KEY,
    MAX_TOKENS,
    MODEL,
    REQUEST_TIMEOUT_S,
    RESPONSE_FORMAT,
)


class ProviderRateLimitError(Exception):
    """Raised when the model provider rejects a request for rate limits."""


class ProviderTimeoutError(Exception):
    """Raised when the model provider times out."""


async def call_model(
    system: str, user: str, schema: dict
) -> AsyncIterator[str]:
    """Stream text chunks from Groq's chat completion API."""
    client = AsyncGroq(api_key=GROQ_API_KEY, timeout=REQUEST_TIMEOUT_S)
    response_format = {"type": RESPONSE_FORMAT}
    if RESPONSE_FORMAT == "json_schema":
        response_format["json_schema"] = {
            "name": "resolve_result",
            "schema": schema,
        }

    stream = None
    try:
        stream = await client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format=response_format,
            max_tokens=MAX_TOKENS,
            stream=True,
        )
        async for chunk in stream:
            content = chunk.choices[0].delta.content
            if content:
                yield content
    except Exception as error:
        from groq import APITimeoutError, RateLimitError

        if isinstance(error, RateLimitError):
            raise ProviderRateLimitError("The model provider rate limit was hit.") from error
        if isinstance(error, (APITimeoutError, TimeoutError)):
            raise ProviderTimeoutError("The model provider timed out.") from error
        raise
    finally:
        if stream is not None:
            close = getattr(stream, "aclose", None)
            if close is not None:
                await close()
        await client.close()
