/**
 * Integration tests for fee-bump transactions (#1159).
 * No live network or Stellar SDK required — Horizon is fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  submitFeeBump,
  DEFAULT_FEE_BUMP_CONFIG,
  FeeBumpConfig,
  HorizonServer,
} from "../stellar-service-integration/feeBump.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORIGINAL_HASH = "abc123originalhash";
const ORIGINAL_FEE = "100";

const testConfig: FeeBumpConfig = {
  ...DEFAULT_FEE_BUMP_CONFIG,
  pendingThresholdMs: 50,
  pollIntervalMs: 5,
  maxPollAttempts: 3,
};

function makeHorizon(overrides: Partial<HorizonServer> = {}): HorizonServer {
  return {
    transactions: () => ({
      transaction: () => ({
        call: vi.fn().mockRejectedValue({ response: { status: 404 } }),
      }),
    }),
    submitTransaction: vi.fn().mockResolvedValue({ hash: "feebumphash" }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("submitFeeBump (#1159)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns confirmed_original when the tx confirms before the threshold", async () => {
    const mockCall = vi.fn().mockResolvedValue({ successful: true, hash: ORIGINAL_HASH });
    const horizon: HorizonServer = {
      transactions: () => ({ transaction: () => ({ call: mockCall }) }),
      submitTransaction: vi.fn(),
    };

    const result = await submitFeeBump(
      ORIGINAL_HASH,
      ORIGINAL_FEE,
      () => ({}),
      horizon,
      testConfig
    );

    expect(result.outcome).toBe("confirmed_original");
    if (result.outcome === "confirmed_original") {
      expect(result.hash).toBe(ORIGINAL_HASH);
    }
    expect(horizon.submitTransaction).not.toHaveBeenCalled();
  });

  it("submits a fee-bump when the tx remains pending past the threshold", async () => {
    const notFound = { response: { status: 404 } };
    const mockCall = vi.fn().mockRejectedValue(notFound);
    const mockSubmit = vi.fn().mockResolvedValue({ hash: "feebumphash" });

    const horizon: HorizonServer = {
      transactions: () => ({ transaction: () => ({ call: mockCall }) }),
      submitTransaction: mockSubmit,
    };

    const result = await submitFeeBump(
      ORIGINAL_HASH,
      ORIGINAL_FEE,
      (fee) => ({ fee }),
      horizon,
      testConfig
    );

    expect(result.outcome).toBe("fee_bumped");
    if (result.outcome === "fee_bumped") {
      expect(result.originalHash).toBe(ORIGINAL_HASH);
      expect(result.feeBumpHash).toBe("feebumphash");
    }
    expect(mockSubmit).toHaveBeenCalledOnce();
  });

  it("does not double-submit if the original confirms between poll and bump", async () => {
    const notFound = { response: { status: 404 } };
    let callCount = 0;

    // First N calls → 404 (stuck), then confirmed
    const mockCall = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= testConfig.maxPollAttempts) {
        return Promise.reject(notFound);
      }
      return Promise.resolve({ successful: true, hash: ORIGINAL_HASH });
    });

    const mockSubmit = vi.fn();
    const horizon: HorizonServer = {
      transactions: () => ({ transaction: () => ({ call: mockCall }) }),
      submitTransaction: mockSubmit,
    };

    const result = await submitFeeBump(
      ORIGINAL_HASH,
      ORIGINAL_FEE,
      (fee) => ({ fee }),
      horizon,
      testConfig
    );

    expect(result.outcome).toBe("confirmed_original");
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("applies the fee multiplier correctly", async () => {
    const notFound = { response: { status: 404 } };
    const mockCall = vi.fn().mockRejectedValue(notFound);
    let capturedFee: string | null = null;

    const horizon: HorizonServer = {
      transactions: () => ({ transaction: () => ({ call: mockCall }) }),
      submitTransaction: vi.fn().mockResolvedValue({ hash: "bumphash" }),
    };

    const customConfig: FeeBumpConfig = { ...testConfig, feeMultiplier: 5 };
    await submitFeeBump(
      ORIGINAL_HASH,
      ORIGINAL_FEE,
      (fee) => { capturedFee = fee; return { fee }; },
      horizon,
      customConfig
    );

    expect(capturedFee).toBe(String(parseInt(ORIGINAL_FEE, 10) * 5));
  });
});
