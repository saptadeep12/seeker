import { describe, expect, it, vi } from 'vitest';
import {
  createLookupChunk,
  createLookupDone,
  createLookupError,
  isCurrentRequest,
  isLookupChunkMessage,
  isLookupDoneMessage,
  isLookupErrorMessage,
  isLookupRequestMessage,
  sendLookupRequest
} from '../src/shared/messages.js';

const validMessage = {
  type: 'LOOKUP_REQUEST',
  requestId: 'request-1',
  selection: 'honey',
  context: 'Thanks, honey.',
  page: { title: 'Example', domain: 'example.com' },
  lang: 'en'
};

describe('isLookupRequestMessage', () => {
  it('accepts a complete lookup request envelope', () => {
    expect(isLookupRequestMessage(validMessage)).toBe(true);
  });

  it('rejects envelopes with missing request fields', () => {
    expect(isLookupRequestMessage({
      ...validMessage,
      page: undefined
    })).toBe(false);
  });

  it('validates correlated streaming messages', () => {
    const result = {
      word: 'honey',
      sense: 'stub',
      meaning: 'Lookup not connected yet',
      confidence: 1,
      other_senses: ['example alternative sense']
    };

    expect(isLookupChunkMessage(createLookupChunk('request-1', 'Lookup '))).toBe(true);
    expect(isLookupDoneMessage(createLookupDone('request-1', result))).toBe(true);
    expect(isLookupErrorMessage(createLookupError('request-1', 'FAILED', 'Failed'))).toBe(true);
    expect(isCurrentRequest(createLookupChunk('request-1', 'x'), 'request-1')).toBe(true);
    expect(isCurrentRequest(createLookupChunk('old', 'x'), 'request-1')).toBe(false);
  });

  it('sends a flat request envelope with its request ID', async () => {
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true }) }
    };

    await sendLookupRequest('request-1', validMessage);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      ...validMessage,
      type: 'LOOKUP_REQUEST'
    });
  });
});
