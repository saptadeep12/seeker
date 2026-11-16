import pytest

from app.ratelimit import (
    InvalidInstallToken,
    RateLimitExceeded,
    RequestLimiter,
    validate_install_token,
)


def test_missing_or_malformed_token_is_rejected() -> None:
    with pytest.raises(InvalidInstallToken):
        validate_install_token(None)
    with pytest.raises(InvalidInstallToken):
        validate_install_token("short")
    with pytest.raises(InvalidInstallToken):
        validate_install_token("invalid token value")


def test_per_token_limit() -> None:
    limiter = RequestLimiter(per_minute=1, per_day=10, global_per_minute=10)

    limiter.check("token-123", now=100)
    with pytest.raises(RateLimitExceeded) as error:
        limiter.check("token-123", now=101)

    assert error.value.retry_after == 59


def test_global_limit_applies_across_tokens() -> None:
    limiter = RequestLimiter(per_minute=10, per_day=10, global_per_minute=1)

    limiter.check("token-123", now=100)
    with pytest.raises(RateLimitExceeded):
        limiter.check("token-456", now=101)


def test_idle_tokens_expire() -> None:
    limiter = RequestLimiter(per_minute=10, per_day=10, global_per_minute=10)

    limiter.check("token-123", now=100)
    assert "token-123" in limiter._tokens
    limiter.check("token-456", now=86500)

    assert "token-123" not in limiter._tokens

