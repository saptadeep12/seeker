import pytest

from app.stream_parse import MeaningParser, StreamParseError


def parse(chunks: list[str]) -> str:
    parser = MeaningParser()
    output = "".join(text for chunk in chunks for text in parser.feed(chunk))
    parser.finish()
    return output


def test_parser_handles_chunks_split_mid_escape() -> None:
    assert parse(
        [
            '{"mea',
            'ning":"line\\',
            'nquote\\',
            '"unicode ',
            '\\u',
            '263A"},"word":"x"}',
        ]
    ) == 'line\nquote"unicode ☺'


def test_parser_handles_unicode_surrogate_pair() -> None:
    assert parse(['{"meaning":"smil', 'e \\uD83D', '\\uDE00"}']) == "smile 😀"


def test_parser_requires_meaning_first() -> None:
    parser = MeaningParser()
    with pytest.raises(StreamParseError):
        list(parser.feed('{"word":"x"}'))
