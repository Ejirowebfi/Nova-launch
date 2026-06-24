/**
 * Integration tests for multi-gateway IPFS fallback (#1151)
 *
 * All external HTTP calls are intercepted via vi.stubGlobal so no real
 * network traffic is produced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IPFSService, _clearMetadataCache, _resetLastKnownGoodGateway } from '../../services/IPFSService';
import type { TokenMetadata } from '../../types';

const MOCK_METADATA: TokenMetadata = {
    name: 'Test Token',
    description: 'A test token',
    image: 'ipfs://QmImageHash',
};

const GATEWAYS = [
    'https://gateway-a.example/ipfs',
    'https://gateway-b.example/ipfs',
    'https://gateway-c.example/ipfs',
];

function okResponse(body: unknown) {
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

function failResponse() {
    return Promise.reject(new Error('Network error'));
}

describe('IPFSService – multi-gateway fallback', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        _clearMetadataCache();
        _resetLastKnownGoodGateway();
        fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns metadata from the primary gateway on success', async () => {
        fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(MOCK_METADATA), { status: 200 }));

        const service = new IPFSService(GATEWAYS);
        const result = await service.getMetadata('ipfs://QmHash');

        expect(result).toEqual(MOCK_METADATA);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy.mock.calls[0][0]).toContain(GATEWAYS[0]);
    });

    it('falls back to the second gateway when the first fails', async () => {
        fetchSpy
            .mockRejectedValueOnce(new Error('Gateway A down'))
            .mockResolvedValueOnce(new Response(JSON.stringify(MOCK_METADATA), { status: 200 }));

        const service = new IPFSService(GATEWAYS);
        const result = await service.getMetadata('ipfs://QmHash');

        expect(result).toEqual(MOCK_METADATA);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(fetchSpy.mock.calls[1][0]).toContain(GATEWAYS[1]);
    });

    it('falls back through all gateways and succeeds on the last one', async () => {
        fetchSpy
            .mockRejectedValueOnce(new Error('A down'))
            .mockRejectedValueOnce(new Error('B down'))
            .mockResolvedValueOnce(new Response(JSON.stringify(MOCK_METADATA), { status: 200 }));

        const service = new IPFSService(GATEWAYS);
        const result = await service.getMetadata('ipfs://QmHash');

        expect(result).toEqual(MOCK_METADATA);
        expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('throws when all gateways fail', async () => {
        fetchSpy.mockRejectedValue(new Error('All down'));

        const service = new IPFSService(GATEWAYS);
        await expect(service.getMetadata('ipfs://QmHash')).rejects.toThrow(
            'Failed to fetch metadata from all gateways',
        );
        expect(fetchSpy).toHaveBeenCalledTimes(GATEWAYS.length);
    });

    it('skips a gateway that returns a non-OK HTTP status', async () => {
        fetchSpy
            .mockResolvedValueOnce(new Response('', { status: 504 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(MOCK_METADATA), { status: 200 }));

        const service = new IPFSService(GATEWAYS);
        const result = await service.getMetadata('ipfs://QmHash');

        expect(result).toEqual(MOCK_METADATA);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('caches a successful response so subsequent calls skip the network', async () => {
        fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(MOCK_METADATA), { status: 200 }));

        const service = new IPFSService(GATEWAYS);
        const uri = 'ipfs://QmCachedHash';

        await service.getMetadata(uri);
        const cached = await service.getMetadata(uri);

        expect(cached).toEqual(MOCK_METADATA);
        expect(fetchSpy).toHaveBeenCalledTimes(1); // second call served from cache
    });

    it('remembers the last-known-good gateway and tries it first on the next call', async () => {
        // First call: gateway A fails, gateway B succeeds → lastKnownGood = B (index 1)
        fetchSpy
            .mockRejectedValueOnce(new Error('A down'))
            .mockResolvedValueOnce(new Response(JSON.stringify(MOCK_METADATA), { status: 200 }));

        const service = new IPFSService(GATEWAYS);
        await service.getMetadata('ipfs://QmFirst');

        fetchSpy.mockClear();
        _clearMetadataCache(); // clear cache so second call hits the network

        // Second call: should start with gateway B (index 1)
        fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(MOCK_METADATA), { status: 200 }));

        await service.getMetadata('ipfs://QmSecond');

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy.mock.calls[0][0]).toContain(GATEWAYS[1]);
    });

    it('respects the per-gateway timeout', async () => {
        // Simulate a gateway that times out by throwing an AbortError
        fetchSpy.mockRejectedValue(
            Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
        );

        const service = new IPFSService(GATEWAYS, 50);
        await expect(service.getMetadata('ipfs://QmTimeout')).rejects.toThrow(
            'Failed to fetch metadata from all gateways',
        );
        expect(fetchSpy).toHaveBeenCalledTimes(GATEWAYS.length);
    });
});
