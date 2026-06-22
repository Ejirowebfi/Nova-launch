import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VaultCard } from '../../components/Vaults/VaultCard';
import type { VaultProjection } from '../../types';

// Stub canvas-confetti so jsdom doesn't blow up
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

// Stub useConfetti to avoid canvas-confetti dependency entirely
vi.mock('../../hooks/useConfetti', () => ({
  useConfetti: () => ({ fire: vi.fn(), stop: vi.fn() }),
}));

// Stub claimVault to avoid real Soroban calls
vi.mock('../../hooks/useVaultContract', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../hooks/useVaultContract')>();
  return {
    ...orig,
    claimVault: vi.fn().mockResolvedValue({ txHash: 'mock-tx-hash' }),
  };
});

// Stub ToastProvider so we don't need it in the tree
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const RECIPIENT = 'GBXYZ1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345';
const OTHER = 'GABC0000000000000000000000000000000000000000000000000000000';

function makeVault(overrides: Partial<VaultProjection> = {}): VaultProjection {
  return {
    streamId: 1,
    creator: OTHER,
    recipient: RECIPIENT,
    amount: '1000',
    status: 'CREATED',
    createdAt: new Date().toISOString(),
    startLedger: 1000,
    endLedger: 2000,
    ...overrides,
  };
}

describe('VaultCard', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('not-yet-vested vault (progress < 100%)', () => {
    it('renders a disabled claim button with "Not yet vested" label', () => {
      render(
        <VaultCard
          vault={makeVault()}
          connectedAddress={RECIPIENT}
          currentLedger={1200}   // 20% through
        />,
      );

      const btn = screen.getByRole('button', { name: /not yet vested/i });
      expect(btn).toBeDisabled();
    });

    it('shows progress bar at ~20%', () => {
      render(
        <VaultCard
          vault={makeVault()}
          connectedAddress={RECIPIENT}
          currentLedger={1200}
        />,
      );

      const bar = screen.getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuenow', '20');
    });

    it('displays the Vesting status badge', () => {
      render(
        <VaultCard
          vault={makeVault()}
          connectedAddress={RECIPIENT}
          currentLedger={1200}
        />,
      );
      // The badge text is exactly "Vesting" — use getAllByText to handle the
      // progress-label "Vesting progress" that also contains the word
      const badges = screen.getAllByText(/^vesting$/i);
      expect(badges.length).toBeGreaterThan(0);
    });
  });

  describe('matured vault (progress = 100%)', () => {
    it('enables the claim button for the beneficiary', () => {
      render(
        <VaultCard
          vault={makeVault()}
          connectedAddress={RECIPIENT}
          currentLedger={2000}
        />,
      );

      const btn = screen.getByRole('button', { name: /^claim$/i });
      expect(btn).not.toBeDisabled();
    });

    it('disables the claim button for a non-beneficiary', () => {
      render(
        <VaultCard
          vault={makeVault()}
          connectedAddress={OTHER}
          currentLedger={2000}
        />,
      );

      const btn = screen.getByRole('button', { name: /not your vault/i });
      expect(btn).toBeDisabled();
    });

    it('disables the claim button when no wallet is connected', () => {
      render(
        <VaultCard
          vault={makeVault()}
          connectedAddress={null}
          currentLedger={2000}
        />,
      );

      const btn = screen.getByRole('button', { name: /not your vault/i });
      expect(btn).toBeDisabled();
    });

    it('shows progress bar at 100%', () => {
      render(
        <VaultCard
          vault={makeVault()}
          connectedAddress={RECIPIENT}
          currentLedger={2000}
        />,
      );

      const bar = screen.getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuenow', '100');
    });

    it('calls claimVault and triggers onClaimed on success', async () => {
      const { claimVault } = await import('../../hooks/useVaultContract');
      const onClaimed = vi.fn();

      render(
        <VaultCard
          vault={makeVault()}
          connectedAddress={RECIPIENT}
          currentLedger={2500}
          onClaimed={onClaimed}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /^claim$/i }));
      await waitFor(() => expect(onClaimed).toHaveBeenCalledWith(1));
      expect(claimVault).toHaveBeenCalledWith(1, RECIPIENT, 'testnet');
    });
  });

  describe('claimed vault', () => {
    it('does not render a claim button', () => {
      render(
        <VaultCard
          vault={makeVault({ status: 'CLAIMED' })}
          connectedAddress={RECIPIENT}
          currentLedger={2000}
        />,
      );

      expect(screen.queryByRole('button', { name: /claim/i })).toBeNull();
    });

    it('shows the Claimed status badge', () => {
      render(
        <VaultCard
          vault={makeVault({ status: 'CLAIMED' })}
          connectedAddress={RECIPIENT}
          currentLedger={2000}
        />,
      );

      expect(screen.getByText(/^claimed$/i)).toBeInTheDocument();
    });
  });

  describe('cancelled vault', () => {
    it('shows the Cancelled status badge and no claim button', () => {
      render(
        <VaultCard
          vault={makeVault({ status: 'CANCELLED' })}
          connectedAddress={RECIPIENT}
          currentLedger={2000}
        />,
      );

      expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /claim/i })).toBeNull();
    });
  });
});
