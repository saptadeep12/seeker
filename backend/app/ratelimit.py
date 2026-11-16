"""In-memory per-install and global request limiting."""

import re
import time
from collections import deque
from dataclasses import dataclass, field

from .config import (
    GLOBAL_RATE_LIMIT_PER_MIN,
    INSTALL_TOKEN_MAX_LENGTH,
    INSTALL_TOKEN_MIN_LENGTH,
    RATE_LIMIT_PER_DAY,
    RATE_LIMIT_PER_MIN,
)

TOKEN_PATTERN = re.compile(
    rf"^[A-Za-z0-9_-]{{{INSTALL_TOKEN_MIN_LENGTH},{INSTALL_TOKEN_MAX_LENGTH}}}$"
)


class InvalidInstallToken(ValueError):
    """Raised when an install token is absent or malformed."""


class RateLimitExceeded(Exception):
    """Raised when a configured request limit has been reached."""

    def __init__(self, retry_after: int) -> None:
        super().__init__("Rate limit exceeded.")
        self.retry_after = retry_after


@dataclass
class _TokenWindow:
    minute: deque[float] = field(default_factory=deque)
    day: deque[float] = field(default_factory=deque)
    last_seen: float = 0.0


def validate_install_token(token: str | None) -> str:
    if token is None or TOKEN_PATTERN.fullmatch(token) is None:
        raise InvalidInstallToken("X-Install-Token is missing or malformed.")
    return token


class RequestLimiter:
    """Bounded-by-idle-expiry limiter for install tokens and all requests."""

    def __init__(
        self,
        per_minute: int = RATE_LIMIT_PER_MIN,
        per_day: int = RATE_LIMIT_PER_DAY,
        global_per_minute: int = GLOBAL_RATE_LIMIT_PER_MIN,
        clock=time.time,
    ) -> None:
        self.per_minute = per_minute
        self.per_day = per_day
        self.global_per_minute = global_per_minute
        self._clock = clock
        self._tokens: dict[str, _TokenWindow] = {}
        self._global: deque[float] = deque()

    def check(self, token: str, now: float | None = None) -> None:
        current = self._clock() if now is None else now
        self._expire_idle(current)
        window = self._tokens.setdefault(token, _TokenWindow())
        self._prune(window.minute, current - 60)
        self._prune(window.day, current - 86400)
        self._prune(self._global, current - 60)

        if len(window.minute) >= self.per_minute:
            raise RateLimitExceeded(self._retry_after(window.minute[0], current, 60))
        if len(window.day) >= self.per_day:
            raise RateLimitExceeded(self._retry_after(window.day[0], current, 86400))
        if len(self._global) >= self.global_per_minute:
            raise RateLimitExceeded(self._retry_after(self._global[0], current, 60))

        window.minute.append(current)
        window.day.append(current)
        window.last_seen = current
        self._global.append(current)

    def _expire_idle(self, now: float) -> None:
        for token, window in list(self._tokens.items()):
            if now - window.last_seen >= 86400:
                del self._tokens[token]

    @staticmethod
    def _prune(values: deque[float], cutoff: float) -> None:
        while values and values[0] <= cutoff:
            values.popleft()

    @staticmethod
    def _retry_after(oldest: float, now: float, window_s: int) -> int:
        return max(1, int(oldest + window_s - now + 0.999))
