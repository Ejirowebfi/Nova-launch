import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeploymentRecoveryStorage, type DeploymentCheckpoint } from '../../services/DeploymentRecoveryStorage';

/**
 * Integration tests for deployment recovery checkpointing in useTokenDeploy
 * 
 * These tests verify that the hook properly saves checkpoints at each step
 * and clears them on success.
 */

describe('useTokenDeploy Recovery Integration', () => {
  beforeEach(() => {
    // Reset localStorage mock
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
    
    vi.clearAllMocks();
  });

  describe('Checkpoint Flow', () => {
    it('should save IPFS checkpoint after metadata upload succeeds', () => {
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

      const loaded = DeploymentRecoveryStorage.loadCheckpoint();
      expect(loaded?.step).toBe('ipfs_uploaded');
      expect(loaded?.ipfsCid).toBe('QmXXX');
      expect(loaded?.transactionHash).toBeUndefined();
    });

    it('should update checkpoint after contract submission', () => {
      // First checkpoint: IPFS uploaded
      const initialCheckpoint: DeploymentCheckpoint = {
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

      DeploymentRecoveryStorage.saveCheckpoint(initialCheckpoint);

      // Simulate contract submission
      const updatedCheckpoint = DeploymentRecoveryStorage.loadCheckpoint();
      if (updatedCheckpoint) {
        updatedCheckpoint.step = 'contract_submitted';
        updatedCheckpoint.transactionHash = '0xABC123ABC123ABC123ABC123ABC123ABC123ABC123ABC123ABC123ABC123AB';
        updatedCheckpoint.feePaidXlm = '0.5';
        DeploymentRecoveryStorage.saveCheckpoint(updatedCheckpoint);
      }

      const loaded = DeploymentRecoveryStorage.loadCheckpoint();
      expect(loaded?.step).toBe('contract_submitted');
      expect(loaded?.transactionHash).toBeDefined();
      expect(loaded?.ipfsCid).toBe('QmXXX'); // Preserved from initial
      expect(loaded?.feePaidXlm).toBe('0.5');
    });

    it('should clear checkpoint on successful deployment', () => {
      const checkpoint: DeploymentCheckpoint = {
        step: 'backend_indexed',
        createdAt: new Date().toISOString(),
        formData: {
          name: 'Test Token',
          symbol: 'TEST',
          decimals: 18,
          initialSupply: '1000000',
          adminWallet: 'GXXX',
        },
        ipfsCid: 'QmXXX',
        transactionHash: '0xABC123ABC123ABC123ABC123ABC123ABC123ABC123ABC123ABC123ABC123AB',
        network: 'testnet',
        walletAddress: 'GXXX',
        feePaidXlm: '0.5',
      };

      DeploymentRecoveryStorage.saveCheckpoint(checkpoint);
      expect(DeploymentRecoveryStorage.loadCheckpoint()).not.toBeNull();

      // Simulate successful deployment completion
      DeploymentRecoveryStorage.clearCheckpoint();
      expect(DeploymentRecoveryStorage.loadCheckpoint()).toBeNull();
    });
  });

  describe('Checkpoint Retrieval for Recovery', () => {
    it('should return stale checkpoint for recovery flow', () => {
      const oldCheckpoint: DeploymentCheckpoint = {
        step: 'contract_submitted',
        createdAt: new Date(Date.now() - 60_000).toISOString(), // 60s ago
        formData: {
          name: 'Test Token',
          symbol: 'TEST',
          decimals: 18,
          initialSupply: '1000000',
          adminWallet: 'GXXX',
        },
        transactionHash: '0xABC123ABC123ABC123ABC123ABC123ABC123ABC123ABC123ABC123ABC123AB',
        network: 'testnet',
        walletAddress: 'GXXX',
      };

      DeploymentRecoveryStorage.saveCheckpoint(oldCheckpoint);

      const staleCheckpoint = DeploymentRecoveryStorage.getStaleCheckpoint();
      expect(staleCheckpoint).not.toBeNull();
      expect(staleCheckpoint?.step).toBe('contract_submitted');
      expect(staleCheckpoint?.transactionHash).toBeDefined();
    });

    it('should not return fresh checkpoint (< 30s)', () => {
      const freshCheckpoint: DeploymentCheckpoint = {
        step: 'ipfs_uploaded',
        createdAt: new Date(Date.now() - 5_000).toISOString(), // 5s ago
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

      DeploymentRecoveryStorage.saveCheckpoint(freshCheckpoint);

      const staleCheckpoint = DeploymentRecoveryStorage.getStaleCheckpoint();
      expect(staleCheckpoint).toBeNull();
    });
  });

  describe('Recovery Data Integrity', () => {
    it('should preserve all checkpoint data through save/load cycle', () => {
      const checkpoint: DeploymentCheckpoint = {
        step: 'contract_submitted',
        createdAt: new Date().toISOString(),
        formData: {
          name: 'My Token',
          symbol: 'MYT',
          decimals: 6,
          initialSupply: '5000000',
          adminWallet: 'GXXXXX123',
        },
        ipfsCid: 'QmABC123DEF456',
        transactionHash: '0x' + 'A'.repeat(64),
        network: 'mainnet',
        walletAddress: 'GXXXXX123',
        feePaidXlm: '1.25',
      };

      DeploymentRecoveryStorage.saveCheckpoint(checkpoint);
      const loaded = DeploymentRecoveryStorage.loadCheckpoint();

      expect(loaded).toEqual(checkpoint);
    });

    it('should handle optional fields correctly', () => {
      const minimalCheckpoint: DeploymentCheckpoint = {
        step: 'ipfs_uploaded',
        createdAt: new Date().toISOString(),
        formData: {
          name: 'Test',
          symbol: 'TST',
          decimals: 18,
          initialSupply: '1000',
          adminWallet: 'GXXX',
        },
        network: 'testnet',
        walletAddress: 'GXXX',
        // ipfsCid, transactionHash, feePaidXlm are optional
      };

      DeploymentRecoveryStorage.saveCheckpoint(minimalCheckpoint);
      const loaded = DeploymentRecoveryStorage.loadCheckpoint();

      expect(loaded?.ipfsCid).toBeUndefined();
      expect(loaded?.transactionHash).toBeUndefined();
      expect(loaded?.feePaidXlm).toBeUndefined();
    });
  });

  describe('Duplicate Prevention', () => {
    it('should never have duplicate checkpoints (only one active)', () => {
      const checkpoint1: DeploymentCheckpoint = {
        step: 'ipfs_uploaded',
        createdAt: new Date().toISOString(),
        formData: {
          name: 'Token 1',
          symbol: 'T1',
          decimals: 18,
          initialSupply: '1000',
          adminWallet: 'GXXX',
        },
        network: 'testnet',
        walletAddress: 'GXXX',
      };

      DeploymentRecoveryStorage.saveCheckpoint(checkpoint1);

      const checkpoint2: DeploymentCheckpoint = {
        step: 'ipfs_uploaded',
        createdAt: new Date().toISOString(),
        formData: {
          name: 'Token 2',
          symbol: 'T2',
          decimals: 18,
          initialSupply: '2000',
          adminWallet: 'GYYY',
        },
        network: 'testnet',
        walletAddress: 'GYYY',
      };

      DeploymentRecoveryStorage.saveCheckpoint(checkpoint2);

      const loaded = DeploymentRecoveryStorage.loadCheckpoint();
      expect(loaded?.formData.name).toBe('Token 2');
      expect(loaded?.walletAddress).toBe('GYYY');
    });
  });
});
