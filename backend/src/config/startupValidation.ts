/**
 * Backend startup validation — checks live reachability of external dependencies
 * and validates that the multi-network Stellar configuration is internally
 * consistent (passphrase ↔ RPC URL ↔ contract address).
 *
 * Call runStartupValidation() after validateEnv() and before app.listen().
 * Throws with a clear message if any critical dependency is unreachable or
 * if the network configuration is mismatched.
 *
 * Validation rules (#1160):
 *  1. STELLAR_NETWORK_PASSPHRASE must match the canonical passphrase for the
 *     configured STELLAR_NETWORK (testnet / mainnet).
 *  2. STELLAR_HORIZON_URL and STELLAR_SOROBAN_RPC_URL must not point at the
 *     opposite network's well-known hostnames.
 *  3. FACTORY_CONTRACT_ID must be set when STELLAR_NETWORK is "mainnet".
 */
import { BackendEnv } from './env';
import { outboundFetch } from '../lib/outboundHttpClient';

// ---------------------------------------------------------------------------
// Internal probe helpers
// ---------------------------------------------------------------------------

interface CheckResult {
  name: string;
  ok: boolean;
  error?: string;
}

async function probe(name: string, fn: () => Promise<void>): Promise<CheckResult> {
  try {
    await fn();
    return { name, ok: true };
  } catch (err) {
    return { name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkDatabase(url: string): Promise<void> {
  // Validate URL format — actual connection is verified by Prisma on first query.
  // A malformed URL should fail fast here.
  const parsed = new URL(url);
  if (!parsed.protocol.startsWith('postgres') && !parsed.protocol.startsWith('mysql') && !parsed.protocol.startsWith('sqlite')) {
    throw new Error(`Unsupported database protocol: ${parsed.protocol}`);
  }
}

// ---------------------------------------------------------------------------
// Structured network validation
// ---------------------------------------------------------------------------

/** Structured result returned by runNetworkValidation. */
export interface NetworkValidationResult {
  horizon: {
    reachable: boolean;
    latencyMs: number | null;
    /** Whether the Horizon root endpoint returned the expected network passphrase. */
    passphraseMatches: boolean;
  };
  rpc: {
    reachable: boolean;
  };
  ipfs: {
    reachable: boolean;
  };
}

const DEFAULT_IPFS_GATEWAY = 'https://gateway.pinata.cloud';

async function probeHorizon(
  url: string,
  expectedPassphrase: string,
): Promise<NetworkValidationResult['horizon']> {
  const t0 = Date.now();
  try {
    const res = await outboundFetch(`${url}/`, { signal: AbortSignal.timeout(5000) });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      return { reachable: false, latencyMs: null, passphraseMatches: false };
    }
    const body = (await res.json()) as { network_passphrase?: string };
    const passphraseMatches = body.network_passphrase === expectedPassphrase;
    return { reachable: true, latencyMs, passphraseMatches };
  } catch {
    return { reachable: false, latencyMs: null, passphraseMatches: false };
  }
}

async function probeRpc(url: string): Promise<NetworkValidationResult['rpc']> {
  try {
    const res = await outboundFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] }),
      signal: AbortSignal.timeout(5000),
    });
    return { reachable: res.ok };
  } catch {
    return { reachable: false };
  }
}

async function probeIpfs(gatewayUrl: string): Promise<NetworkValidationResult['ipfs']> {
  try {
    const res = await outboundFetch(gatewayUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    // Any sub-500 status means the gateway is up and responding
    return { reachable: res.status < 500 };
  } catch {
    return { reachable: false };
  }
}

/**
 * Run live reachability probes against Horizon, Soroban RPC, and the IPFS
 * gateway.  Returns a structured report rather than throwing so callers can
 * decide how to handle partial failures.
 *
 * @param env            Validated backend environment.
 * @param ipfsGatewayUrl Override the IPFS gateway to probe (defaults to
 *                       IPFS_GATEWAY_URL env var or https://gateway.pinata.cloud).
 */
export async function runNetworkValidation(
  env: BackendEnv,
  ipfsGatewayUrl: string = process.env.IPFS_GATEWAY_URL ?? DEFAULT_IPFS_GATEWAY,
): Promise<NetworkValidationResult> {
  const [horizon, rpc, ipfs] = await Promise.all([
    probeHorizon(env.STELLAR_HORIZON_URL, env.STELLAR_NETWORK_PASSPHRASE),
    probeRpc(env.STELLAR_SOROBAN_RPC_URL),
    probeIpfs(ipfsGatewayUrl),
  ]);
  return { horizon, rpc, ipfs };
}

// ---------------------------------------------------------------------------
// Multi-network Stellar configuration validation (#1160)
// ---------------------------------------------------------------------------

const NETWORK_CANONICAL: Record<string, { passphrase: string; horizonHost: string; sorobanHost: string }> = {
  testnet: {
    passphrase: 'Test SDF Network ; September 2015',
    horizonHost: 'horizon-testnet.stellar.org',
    sorobanHost: 'soroban-testnet.stellar.org',
  },
  mainnet: {
    passphrase: 'Public Global Stellar Network ; September 2015',
    horizonHost: 'horizon.stellar.org',
    sorobanHost: 'soroban-mainnet.stellar.org',
  },
};

/**
 * Validate that the Stellar network passphrase, RPC URLs, and contract address
 * are mutually consistent.  Throws with a descriptive message on mismatch.
 */
export function validateNetworkConfig(env: BackendEnv): void {
  const network = env.STELLAR_NETWORK;
  const canonical = NETWORK_CANONICAL[network];

  if (!canonical) {
    throw new Error(`Unknown STELLAR_NETWORK value: "${network}". Must be "testnet" or "mainnet".`);
  }

  // 1. Passphrase must match the canonical value for the network
  if (env.STELLAR_NETWORK_PASSPHRASE !== canonical.passphrase) {
    throw new Error(
      `Network passphrase mismatch for "${network}".\n` +
      `  Expected : "${canonical.passphrase}"\n` +
      `  Configured: "${env.STELLAR_NETWORK_PASSPHRASE}"\n` +
      `Ensure STELLAR_NETWORK_PASSPHRASE matches STELLAR_NETWORK.`
    );
  }

  // 2. Horizon URL must not point at the opposite network
  const oppositeNetwork = network === 'testnet' ? 'mainnet' : 'testnet';
  const opposite = NETWORK_CANONICAL[oppositeNetwork];

  if (env.STELLAR_HORIZON_URL.includes(opposite.horizonHost)) {
    throw new Error(
      `STELLAR_HORIZON_URL points at ${oppositeNetwork} ("${env.STELLAR_HORIZON_URL}") ` +
      `but STELLAR_NETWORK is "${network}". Fix the URL or the network setting.`
    );
  }

  if (env.STELLAR_SOROBAN_RPC_URL.includes(opposite.sorobanHost)) {
    throw new Error(
      `STELLAR_SOROBAN_RPC_URL points at ${oppositeNetwork} ("${env.STELLAR_SOROBAN_RPC_URL}") ` +
      `but STELLAR_NETWORK is "${network}". Fix the URL or the network setting.`
    );
  }

  // 3. Contract address must be set on mainnet
  if (network === 'mainnet' && !env.FACTORY_CONTRACT_ID) {
    throw new Error(
      'FACTORY_CONTRACT_ID must be set when STELLAR_NETWORK is "mainnet".'
    );
  }
}

export async function runStartupValidation(env: BackendEnv): Promise<void> {
  const isProduction = env.NODE_ENV === 'production';

  // Fail fast on static config mismatch — always, regardless of environment
  validateNetworkConfig(env);

  // Run live reachability checks in parallel
  const [networkReport, dbCheck] = await Promise.all([
    runNetworkValidation(env),
    probe('Database URL', () => checkDatabase(env.DATABASE_URL)),
  ]);

  const networkOk =
    networkReport.horizon.reachable &&
    networkReport.rpc.reachable &&
    networkReport.ipfs.reachable;
  const allOk = networkOk && dbCheck.ok;

  if (allOk) {
    console.log('✅ Startup validation passed. Network report:', JSON.stringify(networkReport));
    return;
  }

  const failures: string[] = [];
  if (!networkReport.horizon.reachable) failures.push('  • Stellar Horizon: unreachable');
  if (!networkReport.rpc.reachable) failures.push('  • Stellar Soroban RPC: unreachable');
  if (!networkReport.ipfs.reachable) failures.push('  • IPFS Gateway: unreachable');
  if (!dbCheck.ok) failures.push(`  • Database URL: ${dbCheck.error}`);

  const message = `Startup validation failed:\n${failures.join('\n')}`;

  if (isProduction) {
    throw new Error(message);
  } else {
    console.warn(`⚠️  ${message}`);
  }
}
