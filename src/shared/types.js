/**
 * @typedef {{ title: string, domain: string }} PageContext
 */

/**
 * @typedef {{ selection: string, context: string, page: PageContext, lang: string }} LookupRequest
 */

/**
 * @typedef {{ meaning: string, reset?: boolean }} LookupChunk
 */

/**
 * @typedef {{ word: string, sense: string, meaning: string, confidence: number, other_senses: string[], category: ('english'|'technical'|'general'), domain?: string|null, example?: string|null }} LookupResult
 */

/**
 * @typedef {{ code: ('EMPTY'|'TOO_LONG'|'IN_INPUT'|'NO_BLOCK'), message: string }} CaptureError
 */

/**
 * @typedef {{ type: 'LOOKUP_REQUEST', requestId: string } & LookupRequest} LookupRequestMessage
 */

/**
 * @typedef {{ type: 'LOOKUP_CHUNK', requestId: string, text: string }} LookupChunkMessage
 */

/**
 * @typedef {{ type: 'LOOKUP_DONE', requestId: string, result: LookupResult }} LookupDoneMessage
 */

/**
 * @typedef {{ type: 'LOOKUP_ERROR', requestId: string, code: ('ABORTED'|'FAILED'|'RETRYABLE'|'TIMEOUT'|'RATE_LIMITED'|'INVALID_REQUEST'|'OFFLINE'), message: string }} LookupErrorMessage
 */

/**
 * @typedef {{ type: 'CONSENT_REQUIRED', requestId: string }} ConsentRequiredMessage
 */
