"""Short-lived, process-local cache for validated resolve results."""

import hashlib
import time
from collections import OrderedDict
from dataclasses import dataclass

from .config import CACHE_MAX_ENTRIES, CACHE_TTL_S
from .schema import ResolveResult


def make_cache_key(selection: str, context: str) -> str:
    normalized_selection = selection.strip().lower()
    context_hash = hashlib.sha256(context.encode("utf-8")).hexdigest()
    return f"{normalized_selection}:{context_hash}"


@dataclass
class _Entry:
    result: ResolveResult
    expires_at: float


class ResultCache:
    """An oldest-first bounded cache that never stores request text."""

    def __init__(
        self,
        ttl_s: int = CACHE_TTL_S,
        max_entries: int = CACHE_MAX_ENTRIES,
        clock=time.monotonic,
    ) -> None:
        self.ttl_s = ttl_s
        self.max_entries = max_entries
        self._clock = clock
        self._entries: OrderedDict[str, _Entry] = OrderedDict()

    def get(self, key: str) -> ResolveResult | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        if entry.expires_at <= self._clock():
            del self._entries[key]
            return None
        self._entries.move_to_end(key)
        return entry.result

    def set(self, key: str, result: ResolveResult) -> None:
        self._entries[key] = _Entry(result=result, expires_at=self._clock() + self.ttl_s)
        self._entries.move_to_end(key)
        while len(self._entries) > self.max_entries:
            self._entries.popitem(last=False)
