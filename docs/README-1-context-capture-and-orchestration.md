# Seeker — 1. Context Capture & Orchestration

## Main goal of the project
A browser extension that gives users an **instant, context-aware lookup** of any word or phrase they select. It does not just return every dictionary meaning. It uses the text the word appeared in to return the meaning that fits.

> Example: "honey" in *"Thanks, honey, you're the best"* → **a loved one, someone dear to the speaker**, not the sweet food made by bees.

## Focus of this README
How a word gets **selected**, how the **context around it** is collected, how the extension **coordinates** the request from the page to the result card, and how the **repo is laid out**. Everything before the "brain" (see README 2) is handled here. The lookup itself is a **placeholder** for now.

---

## v1 decisions

| Area | Decision |
|---|---|
| Trigger | **Hotkey only** (e.g. `Alt+S`). No auto-icon on selection, no prefetch. |
| Scope | **On-screen text only**: websites and chats in chatbots. No inputs, textareas, PDFs, or iframes in v1. |
| Context | Selected word **±100 characters**, plus **page title** and **domain** (and `lang`). |
| Phrase length | Maximum **5 words**. Longer selections show "Select up to 5 words" and send nothing. |
| Language | Plain **JavaScript** (no TypeScript). |
| Lookup | **Placeholder** behind a single `resolve()` function, integrated later. |

These are a starting point. We try them, then adjust.

---

## The problem

1. **Selection is messier than it looks.** Selections can cross DOM nodes (bold text, links, inline elements). Chat UIs re-render constantly while text streams in.
2. **A word alone is useless for meaning.** We need the right amount of surrounding text.
3. **Too much context is wasteful.** It costs tokens and time, and leaks more of what the user is reading (see README 3).
4. **Phrases and idioms.** Users select multi-word phrases ("break the ice"), so the unit looked up is not always one word.
5. **Speed.** The card must appear immediately, even when the answer takes a moment.
6. **Race conditions.** Users look up one word after another. Stale responses must never overwrite fresh ones.

## Proposed solution

### Trigger
- User selects text, then presses the hotkey (registered with `chrome.commands`).
- The hotkey press also grants `activeTab`, so the content script can be injected on demand with `chrome.scripting`. Nothing runs on a page until the user asks.

### Context extraction (content script)
1. Read the selection with `window.getSelection()` and its `Range`.
2. **Validate:** selection is not empty, is **5 words or fewer**, and is not inside an `input`, `textarea`, or password field.
3. Take the text of the **nearest block-level ancestor** (`p`, `li`, `div`, etc.), using the block's text content rather than a single text node so inline elements do not cut the context short.
4. Cut **±100 characters** around the selection, snapped to word boundaries.
5. Add `page.title`, `page.domain`, and `lang`.
6. Capture once at hotkey time. Do not hold DOM references, since chat UIs re-render.

### Payload sent to the service worker
```json
{
  "selection": "honey",
  "context": "…text before… Thanks, honey, you're the best. …text after…",
  "page": { "title": "…", "domain": "…" },
  "lang": "en"
}
```

### Result card
- Rendered in a **Shadow DOM** so host-page CSS cannot break it.
- Opens **immediately** in the loading state.
- States: `idle → loading → streaming → done | error`.
- Shows the selected word, the contextual meaning, and an "also means…" link.

### Orchestration (background service worker, Manifest V3)
- **Cache key:** normalized word + hash of the context. The same lookup is never paid for twice.
- **In-flight dedupe:** identical simultaneous requests share one call.
- **Cancellation:** `AbortController` per request. A new hotkey lookup cancels the previous one.
- **Message passing:** content script ↔ service worker over `chrome.runtime` messages. Streaming chunks are forwarded to the card.
- **Storage:** `chrome.storage.local` for cache and settings, with size cap and expiry.
- **Permissions:** `activeTab`, `scripting`, and `storage` only. No `<all_urls>`.

---

## End-to-end flow

```
User selects text, presses hotkey (chrome.commands)
   │
   ▼
Service worker: receives hotkey + activeTab grant, injects content script
   │
   ▼
Content script
   1. Read selection (window.getSelection + Range)
   2. Validate: not empty, ≤ 5 words, not in input/textarea/password
   3. Nearest block text, cut ±100 chars (snapped to word boundaries)
   4. Add page title, domain, lang
   5. Open result card (Shadow DOM) in "loading" state
   6. Send { selection, context, page, lang } to service worker
   │
   ▼
Service worker (orchestrator)
   1. Cache check: normalized word + hash of context
   2. In-flight dedupe; AbortController cancels the previous request
   3. Call lookup.resolve(request, signal)      ← PLACEHOLDER
   4. Forward streamed chunks to the card
   5. Save finished result to chrome.storage.local (size cap + expiry)
   │
   ▼
Result card: loading → streaming → done | error
```

## Lookup placeholder

The orchestrator calls one function and nothing else depends on how the lookup works:

```js
// src/lookup/provider.js
// resolve(request, signal) → async iterable of chunks,
// ending in a final result of this shape (matches README 2):
// { word, sense, meaning, confidence, other_senses }
export async function* resolve(request, signal) { /* … */ }
```

For now `src/lookup/stub.js` returns something like `{ word: "<selection>", meaning: "Lookup not connected yet" }`. This lets selection, context extraction, the card, caching, and cancellation be built and tested end to end. When the real lookup is integrated, only the body of `resolve` changes. With the stub, nothing leaves the device.

---

## Repo structure

```
seeker/
├── README.md                     # overview + how to load the extension
├── docs/
│   ├── 1-context-capture-and-orchestration.md
│   ├── 2-meaning-resolver-and-backend.md
│   └── 3-privacy-and-data-flow.md
├── public/
│   ├── manifest.json             # MV3: commands, activeTab, scripting, storage
│   └── icons/                    # 16, 32, 48, 128 px
├── src/
│   ├── background/
│   │   ├── index.js              # service worker entry: hotkey listener, injection, messages
│   │   ├── orchestrator.js       # cache check, in-flight dedupe, AbortController, chunk forwarding
│   │   └── cache.js              # chrome.storage.local wrapper (size cap + expiry)
│   ├── content/
│   │   ├── index.js              # content script entry, runs on hotkey
│   │   ├── selection.js          # getSelection, validation (≤ 5 words, no inputs)
│   │   ├── context.js            # nearest block text, ±100 chars, word-boundary snap
│   │   └── card/
│   │       ├── card.js           # Shadow DOM host + state machine
│   │       ├── positioning.js    # place the card near the selection
│   │       └── card.css          # styles, loaded inside the shadow root only
│   ├── lookup/                   # PLACEHOLDER, integrated later
│   │   ├── provider.js           # resolve(request, signal) → stream of chunks
│   │   └── stub.js               # returns "Lookup not connected yet"
│   ├── shared/
│   │   ├── types.js              # JSDoc typedefs: LookupRequest, LookupResult, messages
│   │   ├── messages.js           # chrome.runtime message helpers
│   │   └── constants.js          # MAX_WORDS=5, CONTEXT_CHARS=100, cache limits
│   └── options/                  # settings page (added later: hotkey, history, clear)
│       ├── index.html
│       └── options.js
├── tests/
│   ├── context.test.js           # context extraction on sample HTML
│   ├── selection.test.js         # word-count limit, input exclusion
│   ├── orchestrator.test.js      # dedupe, cancellation, cache hits
│   └── fixtures/                 # small HTML pages, chat-style markup
├── package.json
├── vite.config.js                # bundles background + content + options
└── .gitignore
```

### Why it is split this way
- **`background/` vs `content/`** mirror the two runtimes. Content code touches the page (selection, context, card). Background code coordinates (cache, dedupe, cancellation). They only talk through `shared/messages.js`.
- **`lookup/` is isolated.** The orchestrator imports only `provider.js`. Integrating the real lookup means replacing `stub.js`. If a FastAPI backend is added later, it can live in a sibling `backend/` folder at the repo root.
- **`shared/types.js`** uses JSDoc typedefs so editors still give hints without TypeScript.
- **A bundler is kept** (`vite.config.js`) because content scripts injected with `chrome.scripting` cannot use ES module `import`. Bundling lets the source stay modular.
- **`tests/`** focuses on the logic most likely to break: context extraction, the 5-word limit, and cancellation. Chat-style fixtures are worth adding early.

### Suggested build order
1. Manifest + hotkey + on-demand injection
2. `selection.js`
3. `context.js`
4. Card with the stub
5. Orchestrator with cache and cancellation

---

## For further discussion
- Should the context menu and popup search box exist at all in v1, or be dropped?
- Do we show a short "Select up to 5 words" message, or silently ignore long selections?
- After trying ±100 characters, does it need adjusting (more, or sentence-based)?
- Do we add inputs/textareas and PDFs later, and in what order?
