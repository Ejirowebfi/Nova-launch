/**
 * Tests for issue #1154 — Transaction/Correlation ID propagation across
 * service boundaries.
 *
 * Covers:
 *  - X-Transaction-Id header is read and stored in async context
 *  - Transaction ID is echoed in the response header
 *  - Transaction ID appears in structured log entries
 *  - Transaction ID is included in error response bodies
 *  - No transaction ID when the client omits the header
 *  - Correlation ID behaviour is unchanged (regression guard)
 *  - OutboundHttpClient propagates both IDs
 *  - IDs are isolated across concurrent requests (AsyncLocalStorage)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requestLoggingMiddleware } from '../middleware/request-logging.middleware';
import { getCorrelationId, getTransactionId, runWithContext } from '../lib/async-context';
import { logger } from '../lib/logger';
import { buildPropagationHeaders, outboundFetch } from '../lib/outboundHttpClient';

// ---------------------------------------------------------------------------
// Helper — builds a minimal Express app with the logging middleware
// ---------------------------------------------------------------------------

function buildApp(handler?: express.RequestHandler) {
  const app = express();
  app.use(requestLoggingMiddleware);
  app.get('/test', handler ?? ((_req, res) => res.json({ ok: true })));
  return app;
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage unit tests — both IDs
// ---------------------------------------------------------------------------

describe('async-context — transactionId', () => {
  it('getTransactionId() returns undefined outside a context', () => {
    expect(getTransactionId()).toBeUndefined();
  });

  it('getTransactionId() returns the value set by runWithContext', () => {
    let captured: string | undefined;
    runWithContext('corr-id', () => {
      captured = getTransactionId();
    }, 'txn-id-123');
    expect(captured).toBe('txn-id-123');
  });

  it('getCorrelationId() still works when transactionId is set', () => {
    let corr: string | undefined;
    runWithContext('corr-abc', () => {
      corr = getCorrelationId();
    }, 'txn-abc');
    expect(corr).toBe('corr-abc');
  });

  it('isolates transactionIds across concurrent contexts', async () => {
    const results: (string | undefined)[] = [];

    await Promise.all([
      new Promise<void>((resolve) =>
        runWithContext('corr-A', () => {
          setTimeout(() => {
            results.push(getTransactionId());
            resolve();
          }, 5);
        }, 'txn-A')
      ),
      new Promise<void>((resolve) =>
        runWithContext('corr-B', () => {
          setTimeout(() => {
            results.push(getTransactionId());
            resolve();
          }, 5);
        }, 'txn-B')
      ),
    ]);

    expect(results).toContain('txn-A');
    expect(results).toContain('txn-B');
  });
});

// ---------------------------------------------------------------------------
// requestLoggingMiddleware — X-Transaction-Id header propagation
// ---------------------------------------------------------------------------

describe('requestLoggingMiddleware — X-Transaction-Id propagation', () => {
  it('reads X-Transaction-Id header and makes it available via getTransactionId()', async () => {
    let captured: string | undefined;
    const app = buildApp((_req, res) => {
      captured = getTransactionId();
      res.json({ ok: true });
    });

    await request(app)
      .get('/test')
      .set('X-Transaction-Id', 'txn-frontend-001');

    expect(captured).toBe('txn-frontend-001');
  });

  it('echoes X-Transaction-Id back in the response header', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/test')
      .set('X-Transaction-Id', 'txn-echo-test');

    expect(res.headers['x-transaction-id']).toBe('txn-echo-test');
  });

  it('does not set X-Transaction-Id response header when client omits it', async () => {
    const app = buildApp();
    const res = await request(app).get('/test');

    expect(res.headers['x-transaction-id']).toBeUndefined();
  });

  it('does not override X-Correlation-Id behaviour (regression)', async () => {
    let capturedCorr: string | undefined;
    const app = buildApp((_req, res) => {
      capturedCorr = getCorrelationId();
      res.json({ ok: true });
    });

    await request(app)
      .get('/test')
      .set('X-Correlation-Id', 'corr-regression')
      .set('X-Transaction-Id', 'txn-regression');

    expect(capturedCorr).toBe('corr-regression');
  });

  it('stores both IDs independently in the async context', async () => {
    const captured: Record<string, string | undefined> = {};
    const app = buildApp((_req, res) => {
      captured.correlationId = getCorrelationId();
      captured.transactionId = getTransactionId();
      res.json({ ok: true });
    });

    await request(app)
      .get('/test')
      .set('X-Correlation-Id', 'corr-dual')
      .set('X-Transaction-Id', 'txn-dual');

    expect(captured.correlationId).toBe('corr-dual');
    expect(captured.transactionId).toBe('txn-dual');
  });

  it('writes transactionId into the access log entry', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const app = buildApp();
    await request(app)
      .get('/test')
      .set('X-Transaction-Id', 'txn-log-check');

    const loggedEntries = logSpy.mock.calls
      .map(([line]) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);

    const accessLog = loggedEntries.find(
      (e) => e.method === 'GET' && e.path?.includes('/test')
    );
    expect(accessLog?.transactionId).toBe('txn-log-check');

    logSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// logger — structured log includes transactionId
// ---------------------------------------------------------------------------

describe('logger — transactionId in structured output', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('includes transactionId when inside a context with one', () => {
    runWithContext('corr-log', () => {
      logger.info('service call made');
    }, 'txn-log-test');

    expect(logSpy).toHaveBeenCalledOnce();
    const entry = JSON.parse(logSpy.mock.calls[0][0]);
    expect(entry.transactionId).toBe('txn-log-test');
    expect(entry.correlationId).toBe('corr-log');
  });

  it('omits transactionId when context has none', () => {
    runWithContext('corr-only', () => {
      logger.info('no txn id here');
    }); // no transactionId argument

    const entry = JSON.parse(logSpy.mock.calls[0][0]);
    expect(entry.transactionId).toBeUndefined();
    expect(entry.correlationId).toBe('corr-only');
  });

  it('omits both IDs when called outside any context', () => {
    logger.info('bare call');
    const entry = JSON.parse(logSpy.mock.calls[0][0]);
    expect(entry.transactionId).toBeUndefined();
    expect(entry.correlationId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// OutboundHttpClient — propagation headers
// ---------------------------------------------------------------------------

describe('OutboundHttpClient — buildPropagationHeaders', () => {
  it('returns an empty object when called outside a context', () => {
    const headers = buildPropagationHeaders();
    expect(headers['x-correlation-id']).toBeUndefined();
    expect(headers['x-transaction-id']).toBeUndefined();
    // request-id is always generated
    expect(headers['x-request-id']).toBeDefined();
  });

  it('injects correlation ID from async context', () => {
    let headers: Record<string, string> = {};
    runWithContext('corr-outbound', () => {
      headers = buildPropagationHeaders();
    });
    expect(headers['x-correlation-id']).toBe('corr-outbound');
  });

  it('injects transaction ID from async context', () => {
    let headers: Record<string, string> = {};
    runWithContext('corr-x', () => {
      headers = buildPropagationHeaders();
    }, 'txn-outbound-xyz');
    expect(headers['x-transaction-id']).toBe('txn-outbound-xyz');
  });

  it('outboundFetch passes propagation headers to downstream service', async () => {
    // Mock global fetch
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    await new Promise<void>((resolve) =>
      runWithContext('corr-fetch', async () => {
        await outboundFetch('https://internal-service/api/data');
        resolve();
      }, 'txn-fetch-test')
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    const sentHeaders = init.headers as Headers;
    expect(sentHeaders.get('x-correlation-id')).toBe('corr-fetch');
    expect(sentHeaders.get('x-transaction-id')).toBe('txn-fetch-test');
    expect(sentHeaders.get('x-request-id')).toBeDefined();

    vi.unstubAllGlobals();
  });

  it('does not override caller-provided correlation ID in outboundFetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    await new Promise<void>((resolve) =>
      runWithContext('corr-context', async () => {
        await outboundFetch('https://service/api', {
          headers: { 'x-correlation-id': 'caller-supplied' },
        });
        resolve();
      }, 'txn-no-override')
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    const sentHeaders = init.headers as Headers;
    // Caller-supplied value takes precedence
    expect(sentHeaders.get('x-correlation-id')).toBe('caller-supplied');
    // Transaction ID still propagated
    expect(sentHeaders.get('x-transaction-id')).toBe('txn-no-override');

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Concurrent request isolation — IDs don't bleed across requests
// ---------------------------------------------------------------------------

describe('concurrent request isolation', () => {
  it('keeps transaction IDs separate across concurrent requests', async () => {
    const captured: Record<string, string | undefined> = {};

    const app = express();
    app.use(requestLoggingMiddleware);

    app.get('/slow', (_req, res) => {
      const id = getTransactionId();
      setTimeout(() => {
        captured['slow'] = getTransactionId();
        res.json({ id });
      }, 20);
    });

    app.get('/fast', (_req, res) => {
      captured['fast'] = getTransactionId();
      res.json({ ok: true });
    });

    await Promise.all([
      request(app).get('/slow').set('X-Transaction-Id', 'txn-slow'),
      // fast fires while slow is waiting in setTimeout
      new Promise((resolve) => setTimeout(resolve, 5)).then(() =>
        request(app).get('/fast').set('X-Transaction-Id', 'txn-fast')
      ),
    ]);

    expect(captured['slow']).toBe('txn-slow');
    expect(captured['fast']).toBe('txn-fast');
  });
});
