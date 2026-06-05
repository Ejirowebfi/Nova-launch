/**
 * OutboundHttpClient (#1154)
 *
 * A thin wrapper around `fetch` that automatically propagates the current
 * request's correlation ID and transaction ID into outbound HTTP calls.
 *
 * All backend service-to-service calls should use this helper so that
 * distributed traces can be joined by the same IDs across service boundaries.
 *
 * Header reference
 * ─────────────────
 *   X-Correlation-Id   — per-request trace ID (backend-generated if absent)
 *   X-Transaction-Id   — logical transaction ID originated at the frontend page load
 *   X-Request-Id       — unique ID for each individual HTTP call
 *
 * Usage
 * ──────
 *   import { outboundFetch } from '../lib/outboundHttpClient.js';
 *   const data = await outboundFetch('https://other-service/api/foo');
 */

import { getCorrelationId, getTransactionId } from './async-context.js';
import {
  HEADER_CORRELATION_ID,
  HEADER_TRANSACTION_ID,
  HEADER_REQUEST_ID,
} from '../middleware/request-logging.middleware.js';

/**
 * Propagation headers built from the current async context.
 * Returns an empty object when called outside a request context.
 */
export function buildPropagationHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  const correlationId = getCorrelationId();
  if (correlationId) {
    headers[HEADER_CORRELATION_ID] = correlationId;
  }

  const transactionId = getTransactionId();
  if (transactionId) {
    headers[HEADER_TRANSACTION_ID] = transactionId;
  }

  // Generate a fresh per-call request ID so individual hops are traceable
  headers[HEADER_REQUEST_ID] =
    `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  return headers;
}

/**
 * Drop-in replacement for `fetch` that injects propagation headers into
 * every outbound request.
 *
 * @param url     The URL to fetch.
 * @param init    Standard `RequestInit` options (headers are merged, not overwritten).
 */
export async function outboundFetch(
  url: string | URL,
  init: RequestInit = {}
): Promise<Response> {
  const propagation = buildPropagationHeaders();

  const mergedHeaders = new Headers(init.headers);
  for (const [key, value] of Object.entries(propagation)) {
    // Only inject if the caller has not already set the header
    if (!mergedHeaders.has(key)) {
      mergedHeaders.set(key, value);
    }
  }

  return fetch(url, { ...init, headers: mergedHeaders });
}
