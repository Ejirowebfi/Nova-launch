/**
 * DeploymentRecoveryBanner - Detects and prompts for recovery of stuck deployments
 * 
 * Renders when:
 * - A stale deployment checkpoint exists in localStorage
 * - User navigated away or page crashed mid-deployment
 * 
 * Actions:
 * - Resume: Check deployment status and retry failed step
 * - Discard: Clear checkpoint and allow fresh deployment
 */

import React, { useEffect, useState } from 'react';
import { DeploymentRecoveryStorage, type DeploymentCheckpoint } from '../../services/DeploymentRecoveryStorage';
import { getDeploymentStatus } from '../../services/deploymentStatusApi';
import { getErrorMessage } from '../../utils/errors';

interface DeploymentRecoveryBannerProps {
  onResume: (checkpoint: DeploymentCheckpoint) => void;
  onDiscard: () => void;
}

export function DeploymentRecoveryBanner({ onResume, onDiscard }: DeploymentRecoveryBannerProps) {
  const [checkpoint, setCheckpoint] = useState<DeploymentCheckpoint | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // On mount, check for stale checkpoint
  useEffect(() => {
    const staleCheckpoint = DeploymentRecoveryStorage.getStaleCheckpoint();
    setCheckpoint(staleCheckpoint);
  }, []);

  if (!checkpoint) {
    return null; // No stale checkpoint, don't render
  }

  const handleResume = async () => {
    if (!checkpoint.transactionHash) {
      // IPFS uploaded but contract not yet submitted
      // Just resume the deployment form with the cached data
      onResume(checkpoint);
      return;
    }

    // Contract was submitted, check status before resuming
    setStatusLoading(true);
    setStatusError(null);

    try {
      const status = await getDeploymentStatus(checkpoint.transactionHash, checkpoint.network);

      if (status.status === 'CONFIRMED') {
        // Transaction succeeded! Clear checkpoint and show success
        DeploymentRecoveryStorage.clearCheckpoint();
        onResume(checkpoint);
        return;
      }

      if (status.status === 'FAILED') {
        // Transaction failed on-chain, show error details
        setStatusError(
          `On-chain transaction failed: ${status.reason || 'Unknown error'}. ` +
          'Discard this deployment to try again.'
        );
        setStatusLoading(false);
        return;
      }

      // PENDING - still waiting for confirmation
      // Resume and let transaction monitor continue polling
      onResume(checkpoint);
    } catch (error) {
      setStatusError(`Failed to check deployment status: ${getErrorMessage(error)}`);
      setStatusLoading(false);
    }
  };

  const handleDiscard = () => {
    DeploymentRecoveryStorage.clearCheckpoint();
    onDiscard();
  };

  return (
    <div className="mb-4 p-4 border-l-4 border-amber-500 bg-amber-50 rounded">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="font-semibold text-amber-900">Incomplete Deployment Detected</h3>
          <p className="text-sm text-amber-800 mt-1">
            A previous deployment of <strong>{checkpoint.formData.symbol}</strong> didn't complete.
            Step: <code className="bg-amber-100 px-1 rounded">{checkpoint.step}</code>
          </p>
          
          {statusError && (
            <p className="text-sm text-red-700 mt-2 font-medium">{statusError}</p>
          )}

          <div className="text-xs text-amber-700 mt-2 space-y-1">
            <p>Network: <code className="bg-amber-100 px-1">{checkpoint.network}</code></p>
            {checkpoint.transactionHash && (
              <p>Tx Hash: <code className="bg-amber-100 px-1 truncate">{checkpoint.transactionHash.slice(0, 20)}...</code></p>
            )}
          </div>
        </div>

        <div className="flex gap-2 ml-4">
          <button
            onClick={handleResume}
            disabled={statusLoading}
            className="px-3 py-1.5 text-sm font-medium rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {statusLoading ? 'Checking...' : 'Resume'}
          </button>
          <button
            onClick={handleDiscard}
            disabled={statusLoading}
            className="px-3 py-1.5 text-sm font-medium rounded bg-gray-200 text-gray-800 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
