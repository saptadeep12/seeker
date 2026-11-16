"""Incremental parsing of the first JSON ``meaning`` string field."""

import json
from collections.abc import Iterator


class StreamParseError(ValueError):
    """Raised when streamed model output cannot start with a meaning field."""


class MeaningParser:
    """Decode the meaning string from incrementally received JSON text."""

    def __init__(self) -> None:
        self._state = "start"
        self._key = []
        self._value = []
        self._escape = False
        self._unicode_digits = ""
        self._pending_high_surrogate: int | None = None

    def feed(self, chunk: str) -> Iterator[str]:
        """Consume a chunk and yield decoded meaning text available so far."""
        index = 0
        while index < len(chunk):
            char = chunk[index]

            if self._state == "start":
                if char.isspace():
                    index += 1
                    continue
                if char != "{":
                    raise StreamParseError("JSON object must start with '{'.")
                self._state = "before_key"
                index += 1
                continue

            if self._state == "before_key":
                if char.isspace():
                    index += 1
                    continue
                if char != '"':
                    raise StreamParseError("The first JSON field must be meaning.")
                self._state = "key"
                index += 1
                continue

            if self._state == "key":
                if char == '"':
                    try:
                        key = json.loads('"' + "".join(self._key) + '"')
                    except json.JSONDecodeError as error:
                        raise StreamParseError("Invalid JSON field name.") from error
                    if key != "meaning":
                        raise StreamParseError("The first JSON field must be meaning.")
                    self._state = "after_key"
                elif char == "\\":
                    self._key.append(char)
                    self._state = "key_escape"
                else:
                    self._key.append(char)
                index += 1
                continue

            if self._state == "key_escape":
                self._key.append(char)
                self._state = "key"
                index += 1
                continue

            if self._state == "after_key":
                if char.isspace():
                    index += 1
                    continue
                if char != ":":
                    raise StreamParseError("The meaning field must have a value.")
                self._state = "before_value"
                index += 1
                continue

            if self._state == "before_value":
                if char.isspace():
                    index += 1
                    continue
                if char != '"':
                    raise StreamParseError("The meaning field must be a string.")
                self._state = "value"
                index += 1
                continue

            if self._state == "value":
                if char == '"':
                    if self._pending_high_surrogate is not None:
                        yield chr(self._pending_high_surrogate)
                        self._pending_high_surrogate = None
                    self._state = "after_value"
                    index += 1
                    continue
                if char == "\\":
                    self._escape = True
                    self._state = "escape"
                    index += 1
                    continue
                yield from self._decoded_character(char)
                index += 1
                continue

            if self._state == "escape":
                if char == "u":
                    self._unicode_digits = ""
                    self._state = "unicode"
                else:
                    escaped = {
                        '"': '"',
                        "\\": "\\",
                        "/": "/",
                        "b": "\b",
                        "f": "\f",
                        "n": "\n",
                        "r": "\r",
                        "t": "\t",
                    }.get(char)
                    if escaped is None:
                        raise StreamParseError("Invalid JSON escape sequence.")
                    yield from self._decoded_character(escaped)
                    self._state = "value"
                index += 1
                continue

            if self._state == "unicode":
                if char.lower() not in "0123456789abcdef":
                    raise StreamParseError("Invalid JSON unicode escape.")
                self._unicode_digits += char
                index += 1
                if len(self._unicode_digits) == 4:
                    yield from self._decoded_character(
                        chr(int(self._unicode_digits, 16))
                    )
                    self._state = "value"
                continue

            if self._state == "after_value":
                if not char.isspace() and char not in ",}":
                    raise StreamParseError("Invalid JSON after meaning value.")
                self._state = "done"
                index += 1
                continue

            if self._state == "done":
                index += 1

    def finish(self) -> None:
        """Validate that the meaning string was complete."""
        if self._state not in {"after_value", "done"}:
            raise StreamParseError("Stream ended before meaning was complete.")

    def _decoded_character(self, value: str) -> Iterator[str]:
        codepoint = ord(value)
        if self._pending_high_surrogate is not None:
            if 0xDC00 <= codepoint <= 0xDFFF:
                yield chr(
                    0x10000
                    + ((self._pending_high_surrogate - 0xD800) << 10)
                    + codepoint
                    - 0xDC00
                )
                self._pending_high_surrogate = None
                return
            yield chr(self._pending_high_surrogate)
            self._pending_high_surrogate = None
        if 0xD800 <= codepoint <= 0xDBFF:
            self._pending_high_surrogate = codepoint
        else:
            yield value
