# Seeker

Seeker is a Manifest V3 Chrome extension for context-aware word lookups.

## Load the unpacked extension

1. Run `npm install`.
2. Run `npm run build`.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the `dist/` folder.

## Current status

The Phase 1 hotkey flow is implemented: Seeker validates the page selection,
captures nearby text and page metadata, opens the result card, and sends a
request to the service worker. The local stub streams placeholder text; the
service worker forwards chunks and final results, deduplicates in-flight work,
cancels a tab's superseded lookup, and caches successful results in
`chrome.storage.local`. No lookup data leaves the device.

## Manual end-to-end verification

Build and load `dist/` as an unpacked extension, then use a normal webpage:

1. Select one word in a sentence and press `Alt+S`. The card should show loading,
   stream placeholder text, and finish with “Lookup not connected yet”.
2. Select the same word in the same sentence again. The cached result should
   appear immediately, without the streaming delay.
3. Start a lookup, then quickly select a different word and press `Alt+S`.
   Only the latest lookup should update the card.
4. Select six words and press the hotkey. The card should show
   “Select up to 5 words”.
5. Press `Escape`, reopen the card, and click outside it; both actions should
   close the card.
6. Repeat on a dark page and on a page with aggressive global styles. The card
   should retain its dark-mode support and isolated appearance.
7. Start a lookup and stop the Seeker service worker from
   `chrome://serviceworker-internals` (or the service-worker inspection link on
   `chrome://extensions`). The card should time out after 10 seconds, show an
   error, and offer **Try again**.

## Phase 1 limitations and deviations

- Selection is captured only from the top frame; iframe content is excluded.
- Shadow DOM content and selections spanning multiple block-level elements may
  not produce complete context.
- Word counting uses whitespace splitting, so languages without space-delimited
  words are only approximately supported.
- Browser-controlled pages, PDF viewers, form fields, and contenteditable inputs
  are excluded.
- Context is taken from the nearest supported block element and bounded around
  the selection; blocks over 100,000 characters or ranges that cannot be mapped
  fall back to selection-only text.
- The result is a local stub, not a meaning lookup. Cache entries are local, but
  in-flight coordination is in memory and is lost if the MV3 service worker is
  terminated; the card timeout/retry handles this case.
- The card keeps references to its own Shadow DOM elements while mounted. The
  captured page `Range` and page nodes are not retained in the request, cache,
  or message protocol.
- Compared with README 1's initial payload example, requests now include a
  `requestId` for streaming correlation and stale-response rejection.
- The card uses an open Shadow DOM so it can be inspected during development;
  its styles remain scoped to the shadow root.

## Running the backend

From the repository root:

1. Copy `backend/.env.example` to `backend/.env` and set `GROQ_API_KEY` when
   model-backed lookup work is enabled.
2. Install dependencies with `cd backend` followed by `pip install -r requirements.txt`.
3. Start the local API with `uvicorn app.main:app --reload`.
4. Check `http://127.0.0.1:8000/health`; it should return `{"status":"ok"}`.
