/**
 * Middleware: verify HMAC signature on inbound webhook payloads (#1157).
 *
 * Usage:
 *   router.post('/inbound', verifyInboundWebhookSignature(getSecret), handler)
 *
 * The caller supplies a `getSecret` function that resolves the shared secret
 * for the given request (e.g. looked up by subscription ID in the path/query).
 * The middleware reads the raw body, verifies the `X-Webhook-Signature` header,
 * and rejects with 401 if the signature is missing or invalid.
 *
 * Signing scheme (identical to outbound):
 *   header = "v1.<timestamp>.<hmac-sha256-hex>"
 *   signed_message = "<timestamp>.<raw_body_string>"
 */

import { Request, Response, NextFunction } from "express";
import { verifyWebhookSignature } from "../utils/crypto";

export const WEBHOOK_SIGNATURE_HEADER = "x-webhook-signature";

/**
 * Returns an Express middleware that verifies the inbound HMAC signature.
 *
 * @param getSecret  Async function that receives the request and returns the
 *                   shared secret to verify against, or null/undefined to skip
 *                   verification (e.g. when the subscription is not found).
 */
export function verifyInboundWebhookSignature(
  getSecret: (req: Request) => Promise<string | null | undefined>
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const signatureHeader =
      req.headers[WEBHOOK_SIGNATURE_HEADER] as string | undefined;

    if (!signatureHeader) {
      res.status(401).json({
        success: false,
        error: "Missing webhook signature header",
      });
      return;
    }

    // Raw body must be available (set by express.raw() or similar)
    const rawBody: string =
      (req as any).rawBody ??
      (typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body));

    const secret = await getSecret(req);

    if (!secret) {
      res.status(401).json({
        success: false,
        error: "Unknown webhook subscription",
      });
      return;
    }

    const valid = verifyWebhookSignature(rawBody, signatureHeader, secret);

    if (!valid) {
      res.status(401).json({
        success: false,
        error: "Invalid webhook signature",
      });
      return;
    }

    next();
  };
}
