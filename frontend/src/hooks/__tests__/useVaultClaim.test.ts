import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Spies declared before mock factories ──────────────────────────────────────
const mockSendTransaction = vi.fn();
const mockGetTransaction = vi.fn();
const mockPrepareTransaction = vi.fn();
const mockGetAccount = vi.fn();
const mockContractCall = vi.fn();
const mockSignTransaction = vi.fn();

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@stellar/stellar-sdk')>();

  class MockContract {
    call(method: string, ...args: unknown[]) {
      return mockContractCall(method, ...args);
    }
  }

  class MockTransactionBuilder {
    addOperation() { return this; }
    setTimeout() { return this; }
    build() { return { toXDR: () => 'mock-xdr' }; }
    static fromXDR() { return { type: 'tx' }; }
  }

  class MockServer {
    getAccount = mockGetAccount;
    prepareTransaction = mockPrepareTransaction;
    sendTransaction = mockSendTransaction;
    getTransaction = mockGetTransaction;
  }

  return {
    ...orig,
    Contract: MockContract,
    TransactionBuilder: MockTransactionBuilder,
    BASE_FEE: '100',
    nativeToScVal: vi.fn((v: unknown) => ({ value: v })),
    rpc: { Server: MockServer },
  };
});

vi.mock('../../config/stellar', () => ({
  STELLAR_CONFIG: {
    factoryContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACT',
    horizonUrl: 'https://horizon-testnet.stellar.org',
  },
  getNetworkConfig: () => ({
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    horizonUrl: 'https://horizon-testnet.stellar.org',
  }),
}));

vi.mock('../../services/wallet', () => {
  return {
    WalletService: class {
      signTransaction = mockSignTransaction;
    },
  };
});

import { claimVault } from '../useVaultContract';

const CLAIMER = 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12';

describe('claimVault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccount.mockResolvedValue({ id: CLAIMER, sequence: '1' });
    mockPrepareTransaction.mockImplementation(async (tx: unknown) => tx);
    mockSignTransaction.mockResolvedValue('signed-xdr');
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'abc123' });
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS' });
  });

  it('calls contract with claim_stream, claimerAddress, and streamId', async () => {
    await claimVault(42, CLAIMER, 'testnet');
    expect(mockContractCall).toHaveBeenCalledWith(
      'claim_stream',
      expect.objectContaining({ value: CLAIMER }),
      expect.objectContaining({ value: 42 }),
    );
  });

  it('signs the prepared transaction via WalletService', async () => {
    await claimVault(1, CLAIMER, 'testnet');
    expect(mockSignTransaction).toHaveBeenCalledWith('mock-xdr');
  });

  it('returns the transaction hash on success', async () => {
    const result = await claimVault(7, CLAIMER, 'testnet');
    expect(result).toEqual({ txHash: 'abc123' });
  });

  it('polls until the transaction is confirmed', async () => {
    mockGetTransaction
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValue({ status: 'SUCCESS' });

    const result = await claimVault(1, CLAIMER, 'testnet');
    expect(mockGetTransaction).toHaveBeenCalledTimes(3);
    expect(result.txHash).toBe('abc123');
  });

  it('throws when sendTransaction returns ERROR', async () => {
    mockSendTransaction.mockResolvedValue({ status: 'ERROR', hash: 'err' });
    await expect(claimVault(1, CLAIMER, 'testnet')).rejects.toThrow(
      'claim_stream transaction failed',
    );
  });

  it('throws when the confirmed transaction is FAILED', async () => {
    mockGetTransaction.mockResolvedValue({ status: 'FAILED' });
    await expect(claimVault(1, CLAIMER, 'testnet')).rejects.toThrow(
      'claim_stream transaction failed on-chain',
    );
  });
});
