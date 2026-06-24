/**
 * Integration tests for inbound webhook HMAC verification (#1157).
 */

import { describe, it, expect, vi } from "vitest";
import { Request, Response, NextFunction } from "express";
import {
  verifyInboundWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
} from "../middleware/webhookSignature";
import {
  generateWebhookSignature,
  generateWebhookSecret,
} from "../utils/crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(body: string, signatureHeader?: string): Partial<Request> {
  return {
    headers: signatureHeader
      ? { [WEBHOOK_SIGNATURE_HEADER]: signatureHeader }
      : {},
    body,
    rawBody: body,
  } as any;
}

interface MockRes {
  res: Partial<Response>;
  statusCode: number | null;
  jsonBody: any;
}

function makeRes(): MockRes {
  const state = { statusCode: null as number | null, jsonBody: null as any };

  const res: Partial<Response> = {
    status(code: number) {
      state.statusCode = code;
      return this as Response;
    },
    json(data: any) {
      state.jsonBody = data;
      return this as Response;
    },
  };

  return {
    res,
    get statusCode() { return state.statusCode; },
    get jsonBody() { return state.jsonBody; },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("verifyInboundWebhookSignature (#1157)", () => {
  const secret = generateWebhookSecret();
  const payload = JSON.stringify({ event: "token.created", data: { id: "abc" } });

  it("calls next() for a valid signature", async () => {
    const signature = generateWebhookSignature(payload, secret);
    const req = makeReq(payload, signature);
    const mock = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    const middleware = verifyInboundWebhookSignature(async () => secret);
    await middleware(req as Request, mock.res as Response, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 401 when the signature header is missing", async () => {
    const req = makeReq(payload);
    const mock = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    const middleware = verifyInboundWebhookSignature(async () => secret);
    await middleware(req as Request, mock.res as Response, next);

    expect(mock.statusCode).toBe(401);
    expect(mock.jsonBody.error).toMatch(/missing/i);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when the signature is invalid (wrong secret)", async () => {
    const signature = generateWebhookSignature(payload, "wrong-secret");
    const req = makeReq(payload, signature);
    const mock = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    const middleware = verifyInboundWebhookSignature(async () => secret);
    await middleware(req as Request, mock.res as Response, next);

    expect(mock.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when the payload has been tampered with", async () => {
    const signature = generateWebhookSignature(payload, secret);
    const tampered = payload.replace("abc", "xyz");
    const req = makeReq(tampered, signature);
    const mock = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    const middleware = verifyInboundWebhookSignature(async () => secret);
    await middleware(req as Request, mock.res as Response, next);

    expect(mock.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when the subscription secret cannot be resolved", async () => {
    const signature = generateWebhookSignature(payload, secret);
    const req = makeReq(payload, signature);
    const mock = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    const middleware = verifyInboundWebhookSignature(async () => null);
    await middleware(req as Request, mock.res as Response, next);

    expect(mock.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for a replayed (old) signature", async () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 min ago
    const signature = generateWebhookSignature(payload, secret, oldTimestamp);
    const req = makeReq(payload, signature);
    const mock = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    const middleware = verifyInboundWebhookSignature(async () => secret);
    await middleware(req as Request, mock.res as Response, next);

    expect(mock.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
