import pytest
from pydantic import ValidationError

from app.schema import Page, ResolveRequest, ResolveResult


def valid_request() -> ResolveRequest:
    return ResolveRequest(
        selection="honey",
        context="Thanks, honey, you're the best.",
        page=Page(title="Example", domain="example.com"),
    )


def test_valid_request_passes() -> None:
    request = valid_request()

    assert request.selection == "honey"
    assert request.lang == "en"


@pytest.mark.parametrize(
    "selection",
    ["", "one two three four five six", "   "],
)
def test_invalid_selection_is_rejected(selection: str) -> None:
    with pytest.raises(ValidationError):
        ResolveRequest(
            selection=selection,
            context="A context.",
            page=Page(title="Example", domain="example.com"),
        )


def test_oversized_context_is_rejected() -> None:
    with pytest.raises(ValidationError):
        ResolveRequest(
            selection="honey",
            context="x" * 601,
            page=Page(title="Example", domain="example.com"),
        )


def test_confidence_above_one_is_rejected() -> None:
    with pytest.raises(ValidationError):
        ResolveResult(
            meaning="A loved one",
            word="honey",
            category="general",
            sense="term of endearment",
            confidence=1.5,
        )
