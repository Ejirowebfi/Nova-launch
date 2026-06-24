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

async function checkHorizon(url: string): Promise<void> {
  const res = await fetch(`${url}/`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function checkSoroban(url: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

  // Fail fast on network config mismatch — always, regardless of environment
  validateNetworkConfig(env);

  const checks = await Promise.all([
    probe('Stellar Horizon', () => checkHorizon(env.STELLAR_HORIZON_URL)),
    probe('Stellar Soroban RPC', () => checkSoroban(env.STELLAR_SOROBAN_RPC_URL)),
    probe('Database URL', () => checkDatabase(env.DATABASE_URL)),
  ]);

  const failures = checks.filter((c) => !c.ok);

  if (failures.length === 0) {
    console.log('✅ Startup validation passed:', checks.map((c) => c.name).join(', '));
    return;
  }

  const report = failures
    .map((c) => `  • ${c.name}: ${c.error}`)
    .join('\n');

  const message = `Startup validation failed:\n${report}`;

  if (isProduction) {
    // Hard fail in production — a broken deployment should not serve traffic.
    throw new Error(message);
  } else {
    // Warn in development — external services may not be running locally.
    console.warn(`⚠️  ${message}`);
  }
}
