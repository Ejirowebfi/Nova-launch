/**
 * DeploymentRecoveryStorage - Manages persisted partial deployment state
 * Stores checkpoint data to survive page reloads during failed deployments
 *
 * Security: Only stores public form data and IPFS CID—never private keys or signed txs
 */

export interface DeploymentCheckpoint {
  /** Current deployment step: 'ipfs_uploaded' | 'contract_submitted' | 'backend_indexed' */
  step: 'ipfs_uploaded' | 'contract_submitted' | 'backend_indexed';
  
  /** ISO timestamp when checkpoint was created */
  createdAt: string;
  
  /** Public form input data (no private keys) */
  formData: {
    name: string;
    symbol: string;
    decimals: number;
    initialSupply: string;
    adminWallet: string;
  };
  
  /** IPFS CID from metadata upload (if step >= ipfs_uploaded) */
  ipfsCid?: string;
  
  /** Stellar transaction hash (if step >= contract_submitted) */
  transactionHash?: string;
  
  /** Network: testnet or mainnet */
  network: 'testnet' | 'mainnet';
  
  /** Wallet address that initiated deployment */
  walletAddress: string;
  
  /** Fee paid in XLM (for informational purposes only) */
  feePaidXlm?: string;
}

const STORAGE_KEY = 'nova_deployment_checkpoint';
const MIN_CHECKPOINT_AGE_MS = 30_000; // Don't show recovery banner for checkpoints < 30s old

/**
 * Check if checkpoint is stale enough to warrant recovery UI
 */
function isCheckpointStale(checkpoint: DeploymentCheckpoint): boolean {
  const createdTime = new Date(checkpoint.createdAt).getTime();
  const ageMs = Date.now() - createdTime;
  return ageMs > MIN_CHECKPOINT_AGE_MS;
}

export class DeploymentRecoveryStorage {
  /**
   * Save a deployment checkpoint
   */
  static saveCheckpoint(checkpoint: DeploymentCheckpoint): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(checkpoint));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded, cannot save deployment checkpoint');
      } else {
        console.error('Failed to save deployment checkpoint:', error);
      }
    }
  }

  /**
   * Load the current deployment checkpoint (if exists)
   */
  static loadCheckpoint(): DeploymentCheckpoint | null {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return null;

      const checkpoint = JSON.parse(data) as DeploymentCheckpoint;
      
      // Validate structure
      if (!checkpoint.step || !checkpoint.formData || !checkpoint.walletAddress) {
        return null;
      }
      
      return checkpoint;
    } catch (error) {
      console.error('Failed to load deployment checkpoint:', error);
      return null;
    }
  }

  /**
   * Check if there's a valid, stale checkpoint that warrants recovery UI
   */
  static getStaleCheckpoint(): DeploymentCheckpoint | null {
    const checkpoint = this.loadCheckpoint();
    if (!checkpoint) return null;
    
    if (!isCheckpointStale(checkpoint)) {
      return null; // Too fresh, user probably just refreshed intentionally
    }
    
    return checkpoint;
  }

  /**
   * Clear the checkpoint (after successful recovery or user discard)
   */
  static clearCheckpoint(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear deployment checkpoint:', error);
    }
  }
}
