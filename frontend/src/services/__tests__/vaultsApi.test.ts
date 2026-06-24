import { describe, it, expect, vi, afterEach } from 'vitest';
import { calcLedgerProgress, fetchCurrentLedger } from '../vaultsApi';

describe('calcLedgerProgress', () => {
  it('returns 0 when current ledger equals start ledger', () => {
    expect(calcLedgerProgress(100, 100, 200)).toBe(0);
  });

  it('returns 50 at the midpoint', () => {
    expect(calcLedgerProgress(150, 100, 200)).toBe(50);
  });

  it('returns 100 when current ledger equals end ledger', () => {
    expect(calcLedgerProgress(200, 100, 200)).toBe(100);
  });

  it('clamps to 100 when current ledger exceeds end ledger', () => {
    expect(calcLedgerProgress(250, 100, 200)).toBe(100);
  });

  it('clamps to 0 when current ledger is before start ledger', () => {
    expect(calcLedgerProgress(50, 100, 200)).toBe(0);
  });

  it('returns 100 when endLedger equals startLedger (degenerate range)', () => {
    expect(calcLedgerProgress(100, 100, 100)).toBe(100);
  });

  it('returns 100 when endLedger is less than startLedger', () => {
    expect(calcLedgerProgress(100, 200, 100)).toBe(100);
  });

  it('computes fractional progress accurately', () => {
    // 25% through a 400-ledger window
    expect(calcLedgerProgress(1100, 1000, 1400)).toBeCloseTo(25, 5);
  });
});

describe('fetchCurrentLedger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns core_latest_ledger from Horizon root endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ core_latest_ledger: 54321 }),
      }),
    );

    const ledger = await fetchCurrentLedger('https://horizon-testnet.stellar.org');
    expect(ledger).toBe(54321);
    expect(fetch).toHaveBeenCalledWith('https://horizon-testnet.stellar.org/');
  });

  it('throws when Horizon returns a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );

    await expect(
      fetchCurrentLedger('https://horizon-testnet.stellar.org'),
    ).rejects.toThrow('Horizon error: 503');
  });
});
