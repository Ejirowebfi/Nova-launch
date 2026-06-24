import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProposalList } from '../ProposalList';
import * as governanceApi from '../../../services/governanceApi';

describe('ProposalList', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sends the selected from date and clears it from later fetches', async () => {
        const fetchSpy = vi.spyOn(governanceApi, 'fetchProposals').mockResolvedValue({
            proposals: [],
            total: 0,
            page: 1,
            limit: 10,
            totalPages: 1,
        });

        render(<ProposalList limit={10} />);

        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalledTimes(1);
        });

        await act(async () => {
            fireEvent.change(screen.getByLabelText('From'), {
                target: { value: '2026-05-01' },
            });
            await new Promise((resolve) => setTimeout(resolve, 450));
        });

        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalledTimes(2);
        });

        expect(fetchSpy).toHaveBeenLastCalledWith(
            expect.objectContaining({
                page: 1,
                limit: 10,
                sortBy: 'createdAt',
                sortOrder: 'desc',
                startDate: '2026-05-01T00:00:00.000Z',
            })
        );

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Clear dates' }));
            await new Promise((resolve) => setTimeout(resolve, 450));
        });

        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalledTimes(3);
        });

        const lastCallParams = fetchSpy.mock.calls.at(-1)?.[0];

        expect(lastCallParams).toMatchObject({
            page: 1,
            limit: 10,
            sortBy: 'createdAt',
            sortOrder: 'desc',
        });
        expect(lastCallParams).not.toHaveProperty('startDate');
        expect(lastCallParams).not.toHaveProperty('endDate');
    });
});