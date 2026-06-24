import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LogoUploadStep } from '../LogoUploadStep';
import type { IPFSUploadHandle, IPFSUploadResult } from '../../../services/IPFSService';
import type { ImageValidationResult } from '../../../utils/imageValidation';

// ---------------------------------------------------------------------------
// Mock uploadToIPFSWithProgress so we can control success / failure per-test
// ---------------------------------------------------------------------------
const mockUploadToIPFSWithProgress = vi.fn<
  Parameters<typeof import('../../../services/IPFSService').uploadToIPFSWithProgress>,
  IPFSUploadHandle
>();

vi.mock('../../../services/IPFSService', () => ({
  uploadToIPFSWithProgress: (
    ...args: Parameters<typeof mockUploadToIPFSWithProgress>
  ) => mockUploadToIPFSWithProgress(...args),
}));

// ---------------------------------------------------------------------------
// Mock ImageUpload so we can drive file-selection without a real file picker
// ---------------------------------------------------------------------------
vi.mock('../../UI/ImageUpload', () => ({
  ImageUpload: ({
    onImageSelect,
  }: {
    onImageSelect: (file: File, result: ImageValidationResult) => void;
    onImageRemove: () => void;
    label: string;
    helperText?: string;
  }) => (
    <button
      data-testid="mock-image-upload"
      onClick={() => {
        const file = new File(['logo'], 'logo.png', { type: 'image/png' });
        const validationResult: ImageValidationResult = {
          valid: true,
          warnings: [],
        };
        onImageSelect(file, validationResult);
      }}
    >
      Select Image
    </button>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeHandle(result: IPFSUploadResult): IPFSUploadHandle {
  return {
    promise: Promise.resolve(result),
    cancel: vi.fn(),
  };
}

const failHandle = (): IPFSUploadHandle =>
  makeHandle({ success: false, ipfsHash: '', ipfsUrl: '', error: 'Network error' });

const successHandle = (): IPFSUploadHandle =>
  makeHandle({
    success: true,
    ipfsHash: 'QmTestHash',
    ipfsUrl: 'https://gateway.pinata.cloud/ipfs/QmTestHash',
  });

// A handle whose promise never resolves — simulates an in-flight upload
function pendingHandle(): IPFSUploadHandle {
  return {
    promise: new Promise(() => {}),
    cancel: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------
const defaultProps = {
  onNext: vi.fn(),
  onBack: vi.fn(),
  tokenName: 'MyToken',
  tokenSymbol: 'MTK',
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('LogoUploadStep – retry button', () => {
  it('does NOT render a Retry button when there is no error', () => {
    render(<LogoUploadStep {...defaultProps} />);
    expect(screen.queryByRole('button', { name: /retry upload/i })).not.toBeInTheDocument();
  });

  it('renders a Retry button after a failed upload', async () => {
    mockUploadToIPFSWithProgress.mockReturnValue(failHandle());

    render(<LogoUploadStep {...defaultProps} />);

    // Select a file then trigger the upload
    fireEvent.click(screen.getByTestId('mock-image-upload'));
    fireEvent.click(screen.getByRole('button', { name: /upload & continue/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /retry upload/i })).toBeInTheDocument()
    );

    // Error message should also be visible
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('clears the error and re-invokes the upload function when Retry is clicked', async () => {
    // First call fails, second call succeeds
    mockUploadToIPFSWithProgress
      .mockReturnValueOnce(failHandle())
      .mockReturnValueOnce(successHandle());

    render(<LogoUploadStep {...defaultProps} />);

    // Select file and attempt first upload (fails)
    fireEvent.click(screen.getByTestId('mock-image-upload'));
    fireEvent.click(screen.getByRole('button', { name: /upload & continue/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /retry upload/i })).toBeInTheDocument()
    );

    // Click Retry
    fireEvent.click(screen.getByRole('button', { name: /retry upload/i }));

    // Upload should have been called a second time
    await waitFor(() => expect(mockUploadToIPFSWithProgress).toHaveBeenCalledTimes(2));

    // On success onNext is invoked and the error disappears
    await waitFor(() => expect(defaultProps.onNext).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Network error')).not.toBeInTheDocument();
  });

  it('disables the Retry button while an upload is in progress', async () => {
    // First call fails, second call hangs indefinitely (simulates in-flight)
    mockUploadToIPFSWithProgress
      .mockReturnValueOnce(failHandle())
      .mockReturnValueOnce(pendingHandle());

    render(<LogoUploadStep {...defaultProps} />);

    // Select file and fail
    fireEvent.click(screen.getByTestId('mock-image-upload'));
    fireEvent.click(screen.getByRole('button', { name: /upload & continue/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /retry upload/i })).toBeInTheDocument()
    );

    // Click Retry — second upload starts but never resolves
    fireEvent.click(screen.getByRole('button', { name: /retry upload/i }));

    // The Retry button must now be disabled
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /retry upload/i })).toBeDisabled()
    );
  });
});
