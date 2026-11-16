"""Environment-backed backend configuration."""

import os

try:
    from workers import env as _worker_env
except ImportError:
    _worker_env = None

# Local development can still use backend/.env. Workers do not provide a
# project filesystem, so avoid searching for dotenv files at import time there.
if _worker_env is None and os.path.isfile(".env"):
    from dotenv import load_dotenv

    load_dotenv()


def _value(name: str, default: str) -> str:
    if _worker_env is not None:
        try:
            value = getattr(_worker_env, name)
        except AttributeError:
            value = None
        if value is not None:
            return str(value)
    return os.environ.get(name, default)


GROQ_API_KEY = _value("GROQ_API_KEY", "")
MODEL = _value("MODEL", "MODEL")
MAX_CONTEXT_CHARS = int(_value("MAX_CONTEXT_CHARS", "600"))
REQUEST_TIMEOUT_S = int(_value("REQUEST_TIMEOUT_S", "15"))
RATE_LIMIT_PER_MIN = int(_value("RATE_LIMIT_PER_MIN", "30"))
MAX_TOKENS = int(_value("MAX_TOKENS", "300"))
RESPONSE_FORMAT = _value("RESPONSE_FORMAT", "json_object")
CACHE_TTL_S = int(_value("CACHE_TTL_S", "300"))
CACHE_MAX_ENTRIES = int(_value("CACHE_MAX_ENTRIES", "500"))
RATE_LIMIT_PER_DAY = int(_value("RATE_LIMIT_PER_DAY", "500"))
GLOBAL_RATE_LIMIT_PER_MIN = int(_value("GLOBAL_RATE_LIMIT_PER_MIN", "100"))
INSTALL_TOKEN_MIN_LENGTH = int(_value("INSTALL_TOKEN_MIN_LENGTH", "8"))
INSTALL_TOKEN_MAX_LENGTH = int(_value("INSTALL_TOKEN_MAX_LENGTH", "128"))
EXTENSION_ORIGIN = _value(
    "EXTENSION_ORIGIN", "chrome-extension://REPLACE_WITH_EXTENSION_ID"
)
