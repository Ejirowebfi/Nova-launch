export const IPFS_CONFIG = {
    apiKey: import.meta.env.VITE_IPFS_API_KEY || '',
    apiSecret: import.meta.env.VITE_IPFS_API_SECRET || '',
    pinataApiUrl: 'https://api.pinata.cloud',
    pinataGateway: 'https://gateway.pinata.cloud/ipfs',
} as const;

/**
 * Ordered list of IPFS gateways to try when fetching metadata.
 * The first gateway is tried first; on failure the next is tried, and so on.
 * Pinata is listed first because it is the upload target and is most likely
 * to have the content immediately available.
 */
export const IPFS_GATEWAYS: readonly string[] = [
    'https://gateway.pinata.cloud/ipfs',
    'https://ipfs.io/ipfs',
    'https://cloudflare-ipfs.com/ipfs',
    'https://dweb.link/ipfs',
];

/** Per-gateway fetch timeout in milliseconds. */
export const IPFS_GATEWAY_TIMEOUT_MS = 5_000;
