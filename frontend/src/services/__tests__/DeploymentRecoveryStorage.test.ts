import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DeploymentRecoveryStorage, type DeploymentCheckpoint } from '../DeploymentRecoveryStorage';

describe('DeploymentRecoveryStorage', () => {
  beforeEach(() => {
    // Mock localStorage
    const store: Record<string, string> = {};
    global.localStorage = {
      getItem: vi.fn((key) => store[key] || null),
      setItem: vi.fn((key, value) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        Object.keys(store).forEach((key) => delete store[key]);
      }),
      key: vi.fn((index) => Object.keys(store)[index] || null),
      length: 0,
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('saveCheckpoint', () => {
    it('should save checkpoint to localStorage', () => {
      const checkpoint: DeploymentCheckpoint = {
        step: 'ipfs_uploaded',
        createdAt: new Date().toISOString(),
        formData: {
          name: 'Test Token',
          symbol: 'TEST',
          decimals: 18,
          initialSupply: '1000000',
          adminWallet: 'GXXX',
        },
        ipfsCid: 'QmXXX',
        network: 'testnet',
        walletAddress: 'GXXX',
      };

      DeploymentRecoveryStorage.saveCheckpoint(checkpoint);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'nova_deployment_checkpoint',
        JSON.stringify(checkpoint)
      );
    });

    it('should handle quota exceeded gracefully', () => {
      const checkpoint: DeploymentCheckpoint = {
        step: 'ipfs_uploaded',
        createdAt: new Date().toISOString(),
        formData: {
          name: 'Test Token',
          symbol: 'TEST',
          decimals: 18,
          initialSupply: '1000000',
          adminWallet: 'GXXX',
        },
        network: 'testnet',
        walletAddress: 'GXXX',
      };

      const error = new DOMException('QuotaExceededError', 'QuotaExceededError');
      vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
        throw error;
      });

      const consoleSpy = vi.spyOn(console, 'warn');
      DeploymentRecoveryStorage.saveCheckpoint(checkpoint);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('quota exceeded')
      );
    });
  });

  describe('loadCheckpoint', () => {
    it('should load checkpoint from localStorage', () => {
      const checkpoint: DeploymentCheckpoint = {
        step: 'contract_submitted',
        createdAt: new Date().toISOString(),
        formData: {
          name: 'Test Token',
          symbol: 'TEST',
          decimals: 18,
          initialSupply: '1000000',
          adminWallet: 'GXXX',
        },
        ipfsCid: 'QmXXX',
        transactionHash: '0xABC123',
        network: 'testnet',
        walletAddress: 'GXXX',
      };

      vi.mocked(localStorage.getItem).mockReturnValueOnce(JSON.stringify(checkpoint));

      const loaded = DeploymentRecoveryStorage.loadCheckpoint();

      expect(loaded).toEqual(checkpoint);
    });

    it('should return null if no checkpoint exists', () => {
      vi.mocked(localStorage.getItem).mockReturnValueOnce(null);

      const loaded = DeploymentRecoveryStorage.loadCheckpoint();

      expect(loaded).toBeNull();
    });

    it('should return null if checkpoint is malformed', () => {
      vi.mocked(localStorage.getItem).mockReturnValueOnce('invalid json');

      const loaded = DeploymentRecoveryStorage.loadCheckpoint();

      expect(loaded).toBeNull();
    });

    it('should return null if checkpoint is missing required fields', () => {
      const incomplete = { step: 'ipfs_uploaded' };
      vi.mocked(localStorage.getItem).mockReturnValueOnce(JSON.stringify(incomplete));

      const loaded = DeploymentRecoveryStorage.loadCheckpoint();

      expect(loaded).toBeNull();
    });
  });

  describe('getStaleCheckpoint', () => {
    it('should return checkpoint if older than 30 seconds', () => {
      const checkpoint: DeploymentCheckpoint = {
        step: 'ipfs_uploaded',
        createdAt: new Date(Date.now() - 60_000).toISOString(), // 60s ago
        formData: {
          name: 'Test Token',
          symbol: 'TEST',
          decimals: 18,
          initialSupply: '1000000',
          adminWallet: 'GXXX',
        },
        network: 'testnet',
        walletAddress: 'GXXX',
      };

      vi.mocked(localStorage.getItem).mockReturnValueOnce(JSON.stringify(checkpoint));

      const stale = DeploymentRecoveryStorage.getStaleCheckpoint();

      expect(stale).toEqual(checkpoint);
    });

    it('should return null if checkpoint is fresh (< 30 seconds)', () => {
      const checkpoint: DeploymentCheckpoint = {
        step: 'ipfs_uploaded',
        createdAt: new Date(Date.now() - 5_000).toISOString(), // 5s ago
        formData: {
          name: 'Test Token',
          symbol: 'TEST',
          decimals: 18,
          initialSupply: '1000000',
          adminWallet: 'GXXX',
        },
        network: 'testnet',
        walletAddress: 'GXXX',
      };

      vi.mocked(localStorage.getItem).mockReturnValueOnce(JSON.stringify(checkpoint));

      const stale = DeploymentRecoveryStorage.getStaleCheckpoint();

      expect(stale).toBeNull();
    });

    it('should return null if no checkpoint exists', () => {
      vi.mocked(localStorage.getItem).mockReturnValueOnce(null);

      const stale = DeploymentRecoveryStorage.getStaleCheckpoint();

      expect(stale).toBeNull();
    });
  });

  describe('clearCheckpoint', () => {
    it('should remove checkpoint from localStorage', () => {
      DeploymentRecoveryStorage.clearCheckpoint();

      expect(localStorage.removeItem).toHaveBeenCalledWith('nova_deployment_checkpoint');
    });
  });
});
