import json

import pytest

from app import resolve as resolve_module
from app.prompt import SYSTEM_PROMPT, build_user_message
from app.schema import Page, ResolveRequest


def request() -> ResolveRequest:
    return ResolveRequest(
        selection="honey",
        context="Thanks, honey, you're the best.",
        page=Page(title="Example", domain="example.com"),
    )


def chunks(value: str):
    async def stream():
        for chunk in (value[:5], value[5:]):
            yield chunk

    return stream()


@pytest.mark.anyio
async def test_valid_json_is_resolved(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "meaning": "A loved one",
        "word": "honey",
        "category": "general",
        "sense": "term of endearment",
        "confidence": 0.93,
    }

    async def fake_provider(system, user, schema):
        assert schema["title"] == "ResolveResult"
        async for chunk in chunks(json.dumps(payload)):
            yield chunk

    monkeypatch.setattr(resolve_module.provider, "call_model", fake_provider)

    result = await resolve_module.resolve(request())

    assert result.meaning == "A loved one"


@pytest.mark.anyio
async def test_malformed_then_valid_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    outputs = [
        "{not json}",
        json.dumps(
            {
                "meaning": "A loved one",
                "word": "honey",
                "category": "general",
                "sense": "term of endearment",
                "confidence": 0.9,
            }
        ),
    ]

    async def fake_provider(system, user, schema):
        async for chunk in chunks(outputs.pop(0)):
            yield chunk

    monkeypatch.setattr(resolve_module.provider, "call_model", fake_provider)

    assert (await resolve_module.resolve(request())).word == "honey"
    assert outputs == []


@pytest.mark.anyio
async def test_malformed_twice_raises_typed_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_provider(system, user, schema):
        yield "{not json}"

    monkeypatch.setattr(resolve_module.provider, "call_model", fake_provider)

    with pytest.raises(resolve_module.ResolveError, match="invalid JSON"):
        await resolve_module.resolve(request())


@pytest.mark.anyio
async def test_technical_result_includes_domain_and_example(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_provider(system, user, schema):
        yield json.dumps(
            {
                "meaning": "A unit of execution",
                "word": "thread",
                "category": "technical",
                "sense": "concurrent execution path",
                "confidence": 0.88,
                "domain": "programming",
                "example": "The worker runs in a separate thread.",
            }
        )

    monkeypatch.setattr(resolve_module.provider, "call_model", fake_provider)

    result = await resolve_module.resolve(request())

    assert result.domain == "programming"
    assert result.example.startswith("The worker")


def test_prompt_contains_delimiters_and_json_instruction() -> None:
    message = build_user_message(request())

    assert "<context-data>" in message
    assert "</context-data>" in message
    assert "<page-title-data>" in message
    assert "<page-domain-data>" in message
    assert "JSON" in SYSTEM_PROMPT
    assert "no commands" in SYSTEM_PROMPT
