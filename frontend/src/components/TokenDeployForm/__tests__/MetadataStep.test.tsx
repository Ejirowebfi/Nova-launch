import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MetadataStep } from '../MetadataStep';
import type { ImageValidationResult } from '../../../utils/imageValidation';

// Mock ImageUpload to avoid file-picker complexity
vi.mock('../../UI/ImageUpload', () => ({
    ImageUpload: ({
        onImageSelect,
    }: {
        onImageSelect: (file: File, result: ImageValidationResult) => void;
        onImageRemove: () => void;
        label: string;
        helperText?: string;
        required?: boolean;
    }) => (
        <button
            data-testid="mock-image-upload"
            onClick={() => {
                const file = new File(['img'], 'token.png', { type: 'image/png' });
                onImageSelect(file, { valid: true, warnings: [] });
            }}
        >
            Select Image
        </button>
    ),
}));

const defaultProps = {
    onNext: vi.fn(),
    onBack: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());

// Helper: enable metadata toggle and return the textarea
function enableMetadata() {
    render(<MetadataStep {...defaultProps} />);
    fireEvent.click(screen.getByRole('checkbox'));
    return screen.getByRole('textbox', { name: /description/i });
}

describe('MetadataStep – character counter', () => {
    it('shows "500 characters remaining" when description is empty', () => {
        enableMetadata();
        expect(screen.getByText('500 characters remaining')).toBeInTheDocument();
    });

    it('decrements the counter as the user types', () => {
        const textarea = enableMetadata();
        fireEvent.change(textarea, { target: { value: 'Hello' } });
        expect(screen.getByText('495 characters remaining')).toBeInTheDocument();
    });

    it('applies text-red-500 when remainingChars <= 50', () => {
        const textarea = enableMetadata();
        const longText = 'a'.repeat(460); // 500 - 460 = 40 remaining
        fireEvent.change(textarea, { target: { value: longText } });
        const counter = screen.getByText('40 characters remaining');
        expect(counter.className).toContain('text-red-500');
    });

    it('does NOT apply text-red-500 when remainingChars > 50', () => {
        const textarea = enableMetadata();
        fireEvent.change(textarea, { target: { value: 'a'.repeat(100) } }); // 400 remaining
        const counter = screen.getByText('400 characters remaining');
        expect(counter.className).not.toContain('text-red-500');
    });

    it('shows "Character limit reached" when remainingChars === 0', () => {
        const textarea = enableMetadata();
        fireEvent.change(textarea, { target: { value: 'a'.repeat(500) } });
        expect(screen.getByText('Character limit reached')).toBeInTheDocument();
    });

    it('counter is not visible when metadata toggle is off', () => {
        render(<MetadataStep {...defaultProps} />);
        expect(screen.queryByText(/characters remaining/i)).not.toBeInTheDocument();
        expect(screen.queryByText('Character limit reached')).not.toBeInTheDocument();
    });
});
