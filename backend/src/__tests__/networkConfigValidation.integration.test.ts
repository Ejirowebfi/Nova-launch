/**
 * Integration tests for multi-network Stellar configuration validation (#1160).
 */

import { describe, it, expect } from "vitest";
import { validateNetworkConfig } from "../config/startupValidation";
import { BackendEnv } from "../config/env";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnv(overrides: Partial<BackendEnv> = {}): BackendEnv {
  return {
    NODE_ENV: "test",
    PORT: 3001,
    STELLAR_NETWORK: "testnet",
    STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
    STELLAR_SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
    STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    FACTORY_CONTRACT_ID: "",
    DATABASE_URL: "postgresql://localhost/test",
    JWT_SECRET: "test-secret",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateNetworkConfig (#1160)", () => {
  it("passes for a consistent testnet configuration", () => {
    expect(() => validateNetworkConfig(makeEnv())).not.toThrow();
  });

  it("passes for a consistent mainnet configuration", () => {
    const env = makeEnv({
      STELLAR_NETWORK: "mainnet",
      STELLAR_HORIZON_URL: "https://horizon.stellar.org",
      STELLAR_SOROBAN_RPC_URL: "https://soroban-mainnet.stellar.org",
      STELLAR_NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015",
      FACTORY_CONTRACT_ID: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    });
    expect(() => validateNetworkConfig(env)).not.toThrow();
  });

  it("throws when the passphrase does not match the network", () => {
    const env = makeEnv({
      STELLAR_NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015",
    });
    expect(() => validateNetworkConfig(env)).toThrow(/passphrase mismatch/i);
  });

  it("throws when Horizon URL points at the opposite network", () => {
    const env = makeEnv({
      STELLAR_HORIZON_URL: "https://horizon.stellar.org", // mainnet URL on testnet config
    });
    expect(() => validateNetworkConfig(env)).toThrow(/mainnet/);
  });

  it("throws when Soroban RPC URL points at the opposite network", () => {
    const env = makeEnv({
      STELLAR_SOROBAN_RPC_URL: "https://soroban-mainnet.stellar.org",
    });
    expect(() => validateNetworkConfig(env)).toThrow(/mainnet/);
  });

  it("throws when mainnet is configured without a contract address", () => {
    const env = makeEnv({
      STELLAR_NETWORK: "mainnet",
      STELLAR_HORIZON_URL: "https://horizon.stellar.org",
      STELLAR_SOROBAN_RPC_URL: "https://soroban-mainnet.stellar.org",
      STELLAR_NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015",
      FACTORY_CONTRACT_ID: "", // missing
    });
    expect(() => validateNetworkConfig(env)).toThrow(/FACTORY_CONTRACT_ID/);
  });

  it("throws for an unknown network value", () => {
    const env = makeEnv({ STELLAR_NETWORK: "devnet" as any });
    expect(() => validateNetworkConfig(env)).toThrow(/Unknown STELLAR_NETWORK/);
  });
});
