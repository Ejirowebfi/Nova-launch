/**
 * Integration tests for IPFS pin-status monitoring (#1158).
 * Pinata API calls are mocked — no live network required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkPinStatus,
  verifyPin,
  startPinMonitor,
} from "../lib/ipfs/pinMonitor";

const API_KEY = "test-api-key";
const API_SECRET = "test-api-secret";

describe("checkPinStatus (#1158)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns pinned=true when Pinata reports count > 0", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ count: 1, rows: [{ ipfs_pin_hash: "QmABC" }] }),
    });

    const result = await checkPinStatus("QmABC", API_KEY, API_SECRET);

    expect(result.pinned).toBe(true);
    expect(result.cid).toBe("QmABC");
    expect(result.error).toBeUndefined();
  });

  it("returns pinned=false when Pinata reports count=0", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ count: 0, rows: [] }),
    });

    const result = await checkPinStatus("QmMISSING", API_KEY, API_SECRET);

    expect(result.pinned).toBe(false);
  });

  it("returns pinned=false with error on non-OK HTTP response", async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 401 });

    const result = await checkPinStatus("QmABC", API_KEY, API_SECRET);

    expect(result.pinned).toBe(false);
    expect(result.error).toMatch(/401/);
  });

  it("returns pinned=false with error on network failure", async () => {
    (fetch as any).mockRejectedValue(new Error("network error"));

    const result = await checkPinStatus("QmABC", API_KEY, API_SECRET);

    expect(result.pinned).toBe(false);
    expect(result.error).toMatch(/network error/);
  });
});

describe("verifyPin (#1158)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves without error when the CID is pinned", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ count: 1 }),
    });

    await expect(verifyPin("QmABC", API_KEY, API_SECRET)).resolves.toBeUndefined();
  });

  it("throws when the CID is not pinned", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ count: 0 }),
    });

    await expect(verifyPin("QmMISSING", API_KEY, API_SECRET)).rejects.toThrow(
      /Pin verification failed/
    );
  });
});

describe("startPinMonitor (#1158)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("calls onUnpinned for CIDs that are no longer pinned", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ count: 0 }),
    });

    const cids = new Set(["QmUNPINNED"]);
    const onUnpinned = vi.fn();
    const stop = startPinMonitor(cids, API_KEY, API_SECRET, onUnpinned, 1000);

    await vi.advanceTimersByTimeAsync(1100);

    expect(onUnpinned).toHaveBeenCalledWith("QmUNPINNED", undefined);
    stop();
  });

  it("does not call onUnpinned for pinned CIDs", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ count: 1 }),
    });

    const cids = new Set(["QmPINNED"]);
    const onUnpinned = vi.fn();
    const stop = startPinMonitor(cids, API_KEY, API_SECRET, onUnpinned, 1000);

    await vi.advanceTimersByTimeAsync(1100);

    expect(onUnpinned).not.toHaveBeenCalled();
    stop();
  });

  it("stops checking after stop() is called", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ count: 0 }),
    });

    const cids = new Set(["QmABC"]);
    const onUnpinned = vi.fn();
    const stop = startPinMonitor(cids, API_KEY, API_SECRET, onUnpinned, 1000);

    stop();
    await vi.advanceTimersByTimeAsync(2000);

    expect(onUnpinned).not.toHaveBeenCalled();
  });
});
