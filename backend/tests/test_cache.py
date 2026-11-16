import json

import pytest
from fastapi.testclient import TestClient

from app import main
from app.cache import ResultCache, make_cache_key

RESULT = {
    "meaning": "A loved one",
    "word": "honey",
    "category": "general",
    "sense": "term of endearment",
    "confidence": 0.9,
}
HEADERS = {"X-Install-Token": "cache-test-token"}


def payload(context: str = "Thanks, honey.") -> dict:
    return {
        "selection": "honey",
        "context": context,
        "page": {"title": "Cache test", "domain": "example.com"},
    }


def test_cache_hit_skips_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    async def fake_provider(system, user, schema):
        nonlocal calls
        calls += 1
        yield json.dumps(RESULT)

    monkeypatch.setattr(main.provider, "call_model", fake_provider)
    monkeypatch.setattr(main, "result_cache", ResultCache())
    client = TestClient(main.app)

    first = client.post("/v1/resolve", json=payload(), headers=HEADERS)
    second = client.post("/v1/resolve", json=payload(), headers=HEADERS)

    assert first.status_code == second.status_code == 200
    assert calls == 1
    assert "event: meaning" in second.text
    assert "event: result" in second.text


def test_different_context_is_a_cache_miss(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    async def fake_provider(system, user, schema):
        nonlocal calls
        calls += 1
        yield json.dumps(RESULT)

    monkeypatch.setattr(main.provider, "call_model", fake_provider)
    monkeypatch.setattr(main, "result_cache", ResultCache())
    client = TestClient(main.app)

    client.post("/v1/resolve", json=payload("First context."), headers=HEADERS)
    client.post("/v1/resolve", json=payload("Second context."), headers=HEADERS)

    assert calls == 2


def test_errors_are_not_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    async def fake_provider(system, user, schema):
        nonlocal calls
        calls += 1
        yield '{"meaning":"incomplete"'

    monkeypatch.setattr(main.provider, "call_model", fake_provider)
    monkeypatch.setattr(main, "result_cache", ResultCache())
    client = TestClient(main.app)

    first = client.post("/v1/resolve", json=payload(), headers=HEADERS)
    second = client.post("/v1/resolve", json=payload(), headers=HEADERS)

    assert first.status_code == second.status_code == 200
    assert calls == 4
    assert "event: error" in second.text


def test_cache_ttl_expiry() -> None:
    now = [100.0]
    cache = ResultCache(ttl_s=10, clock=lambda: now[0])
    key = make_cache_key(" Honey ", "Context")

    cache.set(key, main.ResolveResult.model_validate(RESULT))
    assert cache.get(key) is not None
    now[0] = 110.0
    assert cache.get(key) is None

