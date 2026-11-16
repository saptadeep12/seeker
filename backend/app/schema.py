"""Request and response models for the Seeker backend."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .config import MAX_CONTEXT_CHARS


class Page(BaseModel):
    title: str = Field(max_length=300)
    domain: str = Field(max_length=200)


class ResolveRequest(BaseModel):
    selection: str = Field(min_length=1, max_length=100)
    context: str = Field(max_length=MAX_CONTEXT_CHARS)
    page: Page
    lang: str = "en"

    @field_validator("selection")
    @classmethod
    def validate_selection(cls, value: str) -> str:
        if not value.split() or len(value.split()) > 5:
            raise ValueError("selection must contain between 1 and 5 words")
        return value


class ResolveResult(BaseModel):
    meaning: str
    word: str
    category: Literal["english", "technical", "general"]
    sense: str
    confidence: float = Field(ge=0, le=1)
    other_senses: list[str] = Field(default_factory=list)
    domain: str | None = None
    example: str | None = None
