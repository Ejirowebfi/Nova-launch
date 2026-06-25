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
 *   traceparent         — W3C distributed-trace context (#1333)
 *
 * Usage
 * ──────
 *   import { outboundFetch } from '../lib/outboundHttpClient.js';
 *   const data = await outboundFetch('https://other-service/api/foo');
 */

import { context, propagation } from '@opentelemetry/api';
import { getCorrelationId, getTransactionId, getTraceContext } from './async-context.js';
import {
  HEADER_CORRELATION_ID,
  HEADER_TRANSACTION_ID,
  HEADER_REQUEST_ID,
} from '../middleware/request-logging.middleware.js';

const HEADER_TRACEPARENT = 'traceparent';

/**
 * Build the `traceparent` header for the active trace context.
 *
 * Prefers the live OpenTelemetry context (so a span created by the auto
 * instrumentations for this call shows up as the parent), falling back to
 * the raw `traceparent` parsed off the inbound request when OTel is
 * disabled (e.g. `OTEL_SDK_DISABLED=true` in tests) so propagation still
 * works without a running SDK.
 */
function buildTraceParentHeader(): string | undefined {
  const injected: Record<string, string> = {};
  propagation.inject(context.active(), injected);
  if (injected[HEADER_TRACEPARENT]) {
    return injected[HEADER_TRACEPARENT];
  }

  return getTraceContext()?.raw;
}

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

  const traceParent = buildTraceParentHeader();
  if (traceParent) {
    headers[HEADER_TRACEPARENT] = traceParent;
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
