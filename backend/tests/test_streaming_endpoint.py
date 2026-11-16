import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app import main
from app.cache import ResultCache
from app.ratelimit import RequestLimiter

RESULT = {
    "meaning": "A loved one",
    "word": "honey",
    "category": "general",
    "sense": "term of endearment",
    "confidence": 0.9,
}
HEADERS = {"X-Install-Token": "test-install-token"}


@pytest.fixture(autouse=True)
def isolate_endpoint_state(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(main, "result_cache", ResultCache())
    monkeypatch.setattr(
        main,
        "request_limiter",
        RequestLimiter(per_minute=30, per_day=500, global_per_minute=100),
    )


def request_payload() -> dict:
    return {
        "selection": "honey",
        "context": "Thanks, honey, you're the best.",
        "page": {"title": "Example", "domain": "example.com"},
    }


def events(body: str) -> list[tuple[str, object]]:
    parsed = []
    for block in body.strip().split("\n\n"):
        lines = block.splitlines()
        parsed.append(
            (lines[0].removeprefix("event: "), json.loads(lines[1][6:]))
        )
    return parsed


def test_streams_meaning_before_result(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_provider(system, user, schema):
        yield '{"meaning":"A loved one","word":"honey","category":"general","sense":"term of endearment","confidence":0.9}'

    monkeypatch.setattr(main.provider, "call_model", fake_provider)

    response = TestClient(main.app).post(
        "/v1/resolve", json=request_payload(), headers=HEADERS
    )

    assert response.status_code == 200
    names = [name for name, _data in events(response.text)]
    assert names[-1] == "result"
    assert all(name == "meaning" for name in names[:-1])


def test_malformed_then_valid_emits_reset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    outputs = [
        '{"meaning":"partial"',
        json.dumps(RESULT),
    ]

    async def fake_provider(system, user, schema):
        yield outputs.pop(0)

    monkeypatch.setattr(main.provider, "call_model", fake_provider)

    response = TestClient(main.app).post(
        "/v1/resolve", json=request_payload(), headers=HEADERS
    )

    assert response.status_code == 200
    names = [name for name, _data in events(response.text)]
    reset_index = names.index("reset")
    assert reset_index > 0
    assert all(name == "meaning" for name in names[:reset_index])
    assert names[-1] == "result"
    assert all(name == "meaning" for name in names[reset_index + 1 : -1])


def test_provider_error_is_an_error_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_provider(system, user, schema):
        yield '{"meaning":"partial",'
        raise TimeoutError

    monkeypatch.setattr(main.provider, "call_model", fake_provider)

    response = TestClient(main.app).post(
        "/v1/resolve", json=request_payload(), headers=HEADERS
    )

    assert response.status_code == 200
    name, data = events(response.text)[-1]
    assert name == "error"
    assert data == {
        "code": "timeout",
        "message": "The lookup timed out.",
        "retryable": True,
    }


def test_malformed_after_retry_is_not_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_provider(system, user, schema):
        yield '{"meaning":"partial"'

    monkeypatch.setattr(main.provider, "call_model", fake_provider)

    response = TestClient(main.app).post(
        "/v1/resolve", json=request_payload(), headers=HEADERS
    )

    final_name, final_data = events(response.text)[-1]
    assert final_name == "error"
    assert final_data["code"] == "malformed_output"
    assert final_data["retryable"] is False


def test_initial_provider_rate_limit_returns_429(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_provider(system, user, schema):
        raise main.provider.ProviderRateLimitError("limited")
        yield ""

    monkeypatch.setattr(main.provider, "call_model", fake_provider)

    response = TestClient(main.app).post(
        "/v1/resolve", json=request_payload(), headers=HEADERS
    )

    assert response.status_code == 429
    assert response.json()["code"] == "provider_rate_limit"


def test_invalid_request_returns_400() -> None:
    payload = request_payload()
    payload["selection"] = "one two three four five six"

    response = TestClient(main.app).post("/v1/resolve", json=payload)

    assert response.status_code == 400
    assert response.json()["code"] == "invalid_request"


def test_missing_install_token_returns_400() -> None:
    response = TestClient(main.app).post("/v1/resolve", json=request_payload())

    assert response.status_code == 400
    assert response.json()["code"] == "invalid_install_token"


@pytest.mark.anyio
async def test_disconnect_closes_provider_stream() -> None:
    closed = False

    async def fake_stream():
        nonlocal closed
        try:
            await __import__("asyncio").sleep(10)
            yield "never"
        finally:
            closed = True

    class DisconnectedRequest:
        async def is_disconnected(self):
            return True

    with pytest.raises(main.ClientDisconnected):
        await main._next_chunk(fake_stream(), DisconnectedRequest())

    assert closed


@pytest.mark.anyio
async def test_connected_client_waits_for_provider_chunk() -> None:
    async def fake_stream():
        await asyncio.sleep(0)
        yield "chunk"

    class ConnectedRequest:
        async def is_disconnected(self):
            return False

    assert await main._next_chunk(fake_stream(), ConnectedRequest()) == "chunk"
