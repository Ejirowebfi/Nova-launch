import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeploymentRecoveryBanner } from '../DeploymentRecoveryBanner';
import * as DeploymentRecoveryStorageModule from '../../../services/DeploymentRecoveryStorage';
import * as deploymentStatusApiModule from '../../../services/deploymentStatusApi';
import type { DeploymentCheckpoint } from '../../../services/DeploymentRecoveryStorage';

const mockCheckpoint: DeploymentCheckpoint = {
  step: 'contract_submitted',
  createdAt: new Date(Date.now() - 60_000).toISOString(),
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

describe('DeploymentRecoveryBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render when no stale checkpoint exists', () => {
    vi.spyOn(DeploymentRecoveryStorageModule.DeploymentRecoveryStorage, 'getStaleCheckpoint').mockReturnValue(null);

    const { container } = render(
      <DeploymentRecoveryBanner onResume={() => {}} onDiscard={() => {}} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('should render when stale checkpoint exists', () => {
    vi.spyOn(DeploymentRecoveryStorageModule.DeploymentRecoveryStorage, 'getStaleCheckpoint').mockReturnValue(mockCheckpoint);

    render(
      <DeploymentRecoveryBanner onResume={() => {}} onDiscard={() => {}} />
    );

    expect(screen.getByText(/Incomplete Deployment Detected/i)).toBeInTheDocument();
    expect(screen.getByText(/TEST/)).toBeInTheDocument();
    expect(screen.getByText(/contract_submitted/)).toBeInTheDocument();
  });

  it('should display checkpoint details', () => {
    vi.spyOn(DeploymentRecoveryStorageModule.DeploymentRecoveryStorage, 'getStaleCheckpoint').mockReturnValue(mockCheckpoint);

    render(
      <DeploymentRecoveryBanner onResume={() => {}} onDiscard={() => {}} />
    );

    expect(screen.getByText('testnet')).toBeInTheDocument();
    expect(screen.getByText(/0xABC123/)).toBeInTheDocument();
  });

  it('should call onResume when Resume button clicked and tx is CONFIRMED', async () => {
    vi.spyOn(DeploymentRecoveryStorageModule.DeploymentRecoveryStorage, 'getStaleCheckpoint').mockReturnValue(mockCheckpoint);
    vi.spyOn(DeploymentRecoveryStorageModule.DeploymentRecoveryStorage, 'clearCheckpoint');
    vi.spyOn(deploymentStatusApiModule, 'getDeploymentStatus').mockResolvedValue({
      txHash: mockCheckpoint.transactionHash!,
      status: 'CONFIRMED',
      ledger: 1000,
    });

    const mockOnResume = vi.fn();
    render(
      <DeploymentRecoveryBanner onResume={mockOnResume} onDiscard={() => {}} />
    );

    const resumeButton = screen.getByText('Resume');
    fireEvent.click(resumeButton);

    await waitFor(() => {
      expect(DeploymentRecoveryStorageModule.DeploymentRecoveryStorage.clearCheckpoint).toHaveBeenCalled();
      expect(mockOnResume).toHaveBeenCalledWith(mockCheckpoint);
    });
  });

  it('should show error when tx is FAILED', async () => {
    vi.spyOn(DeploymentRecoveryStorageModule.DeploymentRecoveryStorage, 'getStaleCheckpoint').mockReturnValue(mockCheckpoint);
    vi.spyOn(deploymentStatusApiModule, 'getDeploymentStatus').mockResolvedValue({
      txHash: mockCheckpoint.transactionHash!,
      status: 'FAILED',
      reason: 'Insufficient balance',
    });

    render(
      <DeploymentRecoveryBanner onResume={() => {}} onDiscard={() => {}} />
    );

    const resumeButton = screen.getByText('Resume');
    fireEvent.click(resumeButton);

    await waitFor(() => {
      expect(screen.getByText(/Insufficient balance/)).toBeInTheDocument();
    });
  });

  it('should call onDiscard when Discard button clicked', async () => {
    vi.spyOn(DeploymentRecoveryStorageModule.DeploymentRecoveryStorage, 'getStaleCheckpoint').mockReturnValue(mockCheckpoint);
    vi.spyOn(DeploymentRecoveryStorageModule.DeploymentRecoveryStorage, 'clearCheckpoint');

    const mockOnDiscard = vi.fn();
    render(
      <DeploymentRecoveryBanner onResume={() => {}} onDiscard={mockOnDiscard} />
    );

    const discardButton = screen.getByText('Discard');
    fireEvent.click(discardButton);

    await waitFor(() => {
      expect(DeploymentRecoveryStorageModule.DeploymentRecoveryStorage.clearCheckpoint).toHaveBeenCalled();
      expect(mockOnDiscard).toHaveBeenCalled();
    });
  });

  it('should handle PENDING status and resume anyway', async () => {
    vi.spyOn(DeploymentRecoveryStorageModule.DeploymentRecoveryStorage, 'getStaleCheckpoint').mockReturnValue(mockCheckpoint);
    vi.spyOn(deploymentStatusApiModule, 'getDeploymentStatus').mockResolvedValue({
      txHash: mockCheckpoint.transactionHash!,
      status: 'PENDING',
      reason: 'Still waiting for confirmation',
    });

    const mockOnResume = vi.fn();
    render(
      <DeploymentRecoveryBanner onResume={mockOnResume} onDiscard={() => {}} />
    );

    const resumeButton = screen.getByText('Resume');
    fireEvent.click(resumeButton);

    await waitFor(() => {
      expect(mockOnResume).toHaveBeenCalledWith(mockCheckpoint);
    });
  });

  it('should disable buttons while checking status', async () => {
    vi.spyOn(DeploymentRecoveryStorageModule.DeploymentRecoveryStorage, 'getStaleCheckpoint').mockReturnValue(mockCheckpoint);
    vi.spyOn(deploymentStatusApiModule, 'getDeploymentStatus').mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({
        txHash: mockCheckpoint.transactionHash!,
        status: 'CONFIRMED',
      }), 100))
    );

    render(
      <DeploymentRecoveryBanner onResume={() => {}} onDiscard={() => {}} />
    );

    const resumeButton = screen.getByText('Resume') as HTMLButtonElement;
    const discardButton = screen.getByText('Discard') as HTMLButtonElement;

    fireEvent.click(resumeButton);

    expect(resumeButton).toBeDisabled();
    expect(discardButton).toBeDisabled();
    expect(screen.getByText('Checking...')).toBeInTheDocument();
  });

  it('should handle API errors gracefully', async () => {
    vi.spyOn(DeploymentRecoveryStorageModule.DeploymentRecoveryStorage, 'getStaleCheckpoint').mockReturnValue(mockCheckpoint);
    vi.spyOn(deploymentStatusApiModule, 'getDeploymentStatus').mockRejectedValue(
      new Error('Network error')
    );

    render(
      <DeploymentRecoveryBanner onResume={() => {}} onDiscard={() => {}} />
    );

    const resumeButton = screen.getByText('Resume');
    fireEvent.click(resumeButton);

    await waitFor(() => {
      expect(screen.getByText(/Failed to check deployment status/)).toBeInTheDocument();
    });
  });
});
