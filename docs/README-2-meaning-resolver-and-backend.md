# Seeker — 2. Meaning Resolver & Backend

## Main goal of the project
A browser extension that gives users an **instant, context-aware lookup** of any word or phrase they select. It uses the text the word appeared in to return the meaning that fits.

> Example: "honey" in *"Thanks, honey, you're the best"* → **a loved one, someone dear to the speaker**, not the sweet food made by bees.

## Focus of this README
The **"main brain"**: how the selected word plus its context is turned into the right meaning, and the **backend** that runs it safely, quickly, and cheaply. The extension side (selection, context capture, card, cache) is in README 1. What leaves the device and why is in README 3.

---

## v1 decisions

| Area | Decision |
|---|---|
| Resolver | **One LLM call per lookup.** No separate router model. |
| Model | **Groq API as a placeholder.** The model name is config (`MODEL` env var), so a better model can be swapped in later. |
| Code style | **Plain Python, no framework** (no LangChain). The official SDK plus one thin provider function. |
| Backend | **FastAPI from day one**, run locally during development. The API key never goes in the extension. |
| Categories | Three: `english`, `technical`, `general`. The model picks the category inside the same call (a `category` field in the output). |
| Language | **English only** in v1. The `lang` field is already in the payload for later. |
| Instant local dictionary | **Not in v1.** |
| Prefetch | **None.** Lookups start from the hotkey only (see README 1). |
| Accounts | **None.** Anonymous install token for rate limiting. |

These are a starting point. We try them, then adjust.

---

## The problem

1. **Ambiguity.** Words like *honey*, *bank*, *crane*, *run* have many senses. A plain dictionary returns all of them.
2. **Informal and figurative use.** Endearments, slang, idioms, and metaphors are not in classic sense inventories like WordNet.
3. **Different kinds of lookups need different answers.** A technical term wants a definition and its domain. An everyday word wants the sense that fits and the alternatives.
4. **Speed.** An LLM call takes noticeable time, but the lookup has to feel instant.
5. **Cost and limits.** Every lookup costs money or free-tier quota if a model is called, so calls must be controlled.
6. **Reliability.** Model output must be structured and predictable for the UI, and the model can be wrong.
7. **Security.** The API key cannot live in the extension. Page text is untrusted and may contain prompt-injection attempts.

## Proposed solution

### Resolver: LLM-first
| Option | Strength | Weakness |
|---|---|---|
| LLM (small, fast model) | Handles slang, idioms, endearments, technical terms | Cost and latency |
| Classic WSD (WordNet + BERT) | Cheap, fast | Misses figurative and informal use |
| On-device model | Private, free | Uneven browser/device support |

**v1 choice: a small, fast LLM**, called through Groq for now. Classic WSD, a local model, or a separate category router can be added later behind the same function (see "Later").

### Categories
The model classifies the lookup inside the same call and the prompt adapts to it:

| Category | When | Extra output |
|---|---|---|
| `english` | Everyday words, phrasal verbs | none |
| `technical` | Terms from a field (programming, medicine, law, …) | `domain`, short `example` |
| `general` | Slang, idioms, endearments, anything unclear. Also the fallback when unsure. | none |

The same page word can be either ("thread", "cell", "mouse"). That is why the category is decided with the surrounding context and the page domain, not from the word alone. Keep each category as a config entry (prompt hint plus extra fields) so a new one is a small change, not a new pipeline.

### Prompt design
- Input: selected word, context window, page title and domain, language.
- Instruction: choose the category, pick the single sense that fits **this** context, explain it in one short line, and list the main alternative senses.
- Page text is passed as **data inside delimiters**, with an explicit instruction that it contains no commands.
- Output: JSON only, no preamble. The word "JSON" appears in the prompt (required by Groq's older JSON mode).
- Keep `meaning` as the **first field** in the output so it can stream early.

### Request (from the extension, see README 1)
```json
{
  "selection": "honey",
  "context": "…text before… Thanks, honey, you're the best. …text after…",
  "page": { "title": "…", "domain": "…" },
  "lang": "en"
}
```

### Output schema
```json
{
  "meaning": "A loved one, someone dear to the speaker",
  "word": "honey",
  "category": "general",
  "sense": "term of endearment",
  "confidence": 0.93,
  "other_senses": ["sweet food made by bees"]
}
```
For `technical`, two optional fields are added: `domain` and `example`.

- Low `confidence` → the card shows the top two senses instead of one confident answer. Treat the number as a rough signal only, since a model's self-reported confidence is not well calibrated. Pick the threshold by looking at the test set.
- `other_senses` powers the "also means…" link, so users can correct a wrong guess.

### Making it feel instant
1. The card opens immediately in the loading state (README 1).
2. The model streams the `meaning` field first, so text shows within the first tokens.
3. Cache by normalized word + context hash, both extension-side (README 1) and backend-side. The backend cache is short-lived and in memory only.
4. Tight prompt and a short output cap for low latency.
5. Targets: first meaning text in **under ~1 s** (see README 3).

---

## Backend

A thin **FastAPI** service, written as plain Python.

- `POST /v1/resolve` streams the result (server-sent events: partial `meaning` text as it arrives, then the final validated JSON).
- Holds the model API key server-side, read from environment variables.
- Validates the request size, and validates the model's JSON with **Pydantic**. Retries once on malformed output.
- Rate-limits per anonymous install token.
- Timeouts and a clean error response, so the card can show "couldn't resolve, try again".
- Honors cancellation: if the extension aborts a request (a new lookup started), stop the model call.
- No prompt or sentence content is stored (see README 3).

### The provider function
The only code that knows which model is behind the service:

```python
# backend/app/provider.py
# call_model(system, user, schema) -> async iterator of text chunks
async def call_model(system: str, user: str, schema: dict): ...
```

Groq's API is OpenAI-compatible, so this is the official SDK's streaming chat call, with the model name from config. Changing models later means editing this one function and the `MODEL` setting. Nothing else depends on it.

### Groq notes
- The strict `json_schema` response format only works on some models. On the others, use the older `json_object` mode. Either way, validate with Pydantic and retry once.
- Free-tier limits differ by model. Check the limits page in the Groq console for the model you pick. At free-tier rates, caching and per-install rate limiting matter a lot.

### Suggested layout
```
backend/
├── app/
│   ├── main.py          # FastAPI app, /v1/resolve route
│   ├── resolve.py       # builds the prompt, calls the model, validates, retries once
│   ├── prompt.py        # system prompt, category entries
│   ├── schema.py        # Pydantic models: request, result
│   ├── provider.py      # call_model(...), the only model-specific code
│   ├── cache.py         # short-lived in-memory cache
│   ├── ratelimit.py     # per-install-token limiter
│   └── config.py        # env vars: API key, MODEL, limits, timeouts
├── eval/
│   ├── examples.jsonl   # labeled test set
│   └── run_eval.py
├── tests/
├── requirements.txt
└── .env.example
```

### Errors the card must handle
| Case | Backend response | Card shows |
|---|---|---|
| Model timeout | error with a retryable flag | "couldn't resolve, try again" |
| Malformed JSON after the retry | error | same |
| Rate limit hit (ours or the provider's) | 429 | "too many lookups, wait a moment" |
| Oversized or invalid request | 400 | nothing is sent in normal use |

---

## Quality

Build a small **test set of ~100 labeled examples** (honey, bank, crane, "break the ice", slang, technical terms like "thread" and "mutex") and run it whenever the prompt or model changes. Each example has the expected sense **and** the expected category. Track:
- Sense accuracy
- Category accuracy
- Valid-JSON rate
- Time to first text

This is how we know a change helped, and how we compare a better model against the Groq placeholder.

## Later (not in v1)
- A separate category router (rules and domain hints, or a fast classifier model) in front of the call. Jev from TypeSafe was considered and parked until the basic version works. It would go inside `resolve.py` only.
- Classic WSD or an on-device model as a cheaper fallback.
- More categories, one config entry each.
- Multilingual support.
- A local dictionary shown while the contextual meaning streams in.

---

## For further discussion
- Which free model on Groq (or elsewhere) gives the best speed and quality for the placeholder? Pick it by running the test set.
- Where to deploy the backend once it leaves local development?
- What confidence threshold switches the card to "two senses"?
