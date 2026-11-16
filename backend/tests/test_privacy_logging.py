import json
import logging

from fastapi.testclient import TestClient

from app import main
from app.cache import ResultCache


def test_logs_do_not_contain_request_text(monkeypatch, caplog) -> None:
    selection = "private-selection-unique"
    context = "private context sentence unique"
    title = "private page title unique"
    domain = "private.example.unique"

    async def fake_provider(system, user, schema):
        yield json.dumps(
            {
                "meaning": "A private result",
                "word": selection,
                "category": "general",
                "sense": "test",
                "confidence": 0.9,
            }
        )

    monkeypatch.setattr(main.provider, "call_model", fake_provider)
    monkeypatch.setattr(main, "result_cache", ResultCache())
    monkeypatch.setattr(
        main,
        "request_limiter",
        main.RequestLimiter(per_minute=10, per_day=10, global_per_minute=10),
    )

    with caplog.at_level(logging.INFO, logger="seeker.backend"):
        response = TestClient(main.app).post(
            "/v1/resolve",
            headers={"X-Install-Token": "privacy-test-token"},
            json={
                "selection": selection,
                "context": context,
                "page": {"title": title, "domain": domain},
            },
        )

    assert response.status_code == 200
    assert selection not in caplog.text
    assert context not in caplog.text
    assert title not in caplog.text
    assert domain not in caplog.text
