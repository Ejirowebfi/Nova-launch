/**
 * Snapshot Tests for GraphQL Subscription Event Schemas
 *
 * Lock the subscription event payload shapes across version upgrade boundaries.
 * Breaking schema changes (field renames, type changes, removals) will cause
 * snapshot mismatches, making regressions immediately visible.
 *
 * Events are driven through the real eventBus — subscription resolvers are NOT
 * mocked; this tests the full subscribe → resolve path.
 *
 * Schema version: v1 — captured 2026-06-23
 *
 * Coverage (4 active subscription types in resolvers.ts):
 * ┌──────────────────────────────┬─────────────────────────────────────────┐
 * │ Subscription Field           │ eventBus Topic                          │
 * ├──────────────────────────────┼─────────────────────────────────────────┤
 * │ tokenDeployed                │ token.deployed                          │
 * │ burnExecuted                 │ burn.executed                           │
 * │ proposalStatusChanged        │ governance.proposal.statusChanged       │
 * │ vaultMatured                 │ vault.matured                           │
 * └──────────────────────────────┴─────────────────────────────────────────┘
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventBus } from "../services/eventBus";
import {
  resolvers,
  eventBusAsyncIterator,
  SUBSCRIPTION_TOPICS,
  type TokenDeployedPayload,
  type BurnExecutedPayload,
  type ProposalStatusChangedPayload,
  type VaultMaturedPayload,
} from "../graphql/resolvers";

vi.mock("../lib/prisma", () => ({
  prisma: {
    token: { findUnique: vi.fn(), findMany: vi.fn() },
    burnRecord: { findMany: vi.fn() },
    stream: { findUnique: vi.fn(), findMany: vi.fn() },
    proposal: { findUnique: vi.fn(), findMany: vi.fn() },
    vote: { findMany: vi.fn() },
    campaign: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Emit an event on the bus and collect the first payload yielded by an iterator. */
async function emitAndCollect<T>(
  bus: EventBus,
  topic: string,
  payload: T
): Promise<T> {
  const iter = eventBusAsyncIterator<T>(topic, () => true, bus);
  const pending = iter.next();
  await bus.publish(topic, payload);
  const { value } = await pending;
  await iter.return!();
  return value;
}

// ---------------------------------------------------------------------------
// Schema version: v1 — 2026-06-23
// ---------------------------------------------------------------------------

describe("GraphQL subscription event schema snapshots (v1)", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  // ── tokenDeployed ──────────────────────────────────────────────────────────

  describe("tokenDeployed", () => {
    const payload: TokenDeployedPayload = {
      creatorAddress: "GCREATOR_SNAP_001",
      tokenAddress: "CTOKEN_SNAP_001",
      name: "Snapshot Token",
      symbol: "SNAP",
      totalSupply: BigInt("1000000000"),
      txHash: "tx_snap_token_deployed_001",
      timestamp: "2026-06-23T00:00:00.000Z",
    };

    it("emitted payload matches schema v1 snapshot", async () => {
      const raw = await emitAndCollect(bus, SUBSCRIPTION_TOPICS.tokenDeployed, payload);
      const resolved = resolvers.Subscription.tokenDeployed.resolve(raw);

      expect(resolved).toMatchInlineSnapshot(`
        {
          "creatorAddress": "GCREATOR_SNAP_001",
          "name": "Snapshot Token",
          "symbol": "SNAP",
          "timestamp": "2026-06-23T00:00:00.000Z",
          "tokenAddress": "CTOKEN_SNAP_001",
          "totalSupply": "1000000000",
          "txHash": "tx_snap_token_deployed_001",
        }
      `);
    });

    it("totalSupply BigInt is serialised to string (no JSON lossiness)", async () => {
      const largeSupply = BigInt("99999999999999999999");
      const raw = await emitAndCollect(bus, SUBSCRIPTION_TOPICS.tokenDeployed, {
        ...payload,
        totalSupply: largeSupply,
      });
      const resolved = resolvers.Subscription.tokenDeployed.resolve(raw);

      expect(typeof resolved.totalSupply).toBe("string");
      expect(resolved.totalSupply).toBe("99999999999999999999");
    });
  });

  // ── burnExecuted ───────────────────────────────────────────────────────────

  describe("burnExecuted", () => {
    const payload: BurnExecutedPayload = {
      creatorAddress: "GCREATOR_SNAP_001",
      tokenAddress: "CTOKEN_SNAP_001",
      amount: BigInt("500000"),
      burnedBy: "GBURNER_SNAP_001",
      isAdminBurn: false,
      txHash: "tx_snap_burn_001",
      timestamp: "2026-06-23T00:00:00.000Z",
    };

    it("emitted payload matches schema v1 snapshot", async () => {
      const raw = await emitAndCollect(bus, SUBSCRIPTION_TOPICS.burnExecuted, payload);
      const resolved = resolvers.Subscription.burnExecuted.resolve(raw);

      expect(resolved).toMatchInlineSnapshot(`
        {
          "amount": "500000",
          "burnedBy": "GBURNER_SNAP_001",
          "creatorAddress": "GCREATOR_SNAP_001",
          "isAdminBurn": false,
          "timestamp": "2026-06-23T00:00:00.000Z",
          "tokenAddress": "CTOKEN_SNAP_001",
          "txHash": "tx_snap_burn_001",
        }
      `);
    });

    it("admin burn flag is preserved in serialised shape", async () => {
      const raw = await emitAndCollect(bus, SUBSCRIPTION_TOPICS.burnExecuted, {
        ...payload,
        isAdminBurn: true,
      });
      const resolved = resolvers.Subscription.burnExecuted.resolve(raw);

      expect(resolved.isAdminBurn).toBe(true);
    });
  });

  // ── proposalStatusChanged ──────────────────────────────────────────────────

  describe("proposalStatusChanged", () => {
    const payload: ProposalStatusChangedPayload = {
      creatorAddress: "GCREATOR_SNAP_001",
      proposalId: 42,
      tokenAddress: "CTOKEN_SNAP_001",
      status: "PASSED",
      previousStatus: "ACTIVE",
      txHash: "tx_snap_proposal_001",
      timestamp: "2026-06-23T00:00:00.000Z",
    };

    it("emitted payload matches schema v1 snapshot", async () => {
      const raw = await emitAndCollect(
        bus,
        SUBSCRIPTION_TOPICS.proposalStatusChanged,
        payload
      );
      const resolved = resolvers.Subscription.proposalStatusChanged.resolve(raw);

      expect(resolved).toMatchInlineSnapshot(`
        {
          "creatorAddress": "GCREATOR_SNAP_001",
          "previousStatus": "ACTIVE",
          "proposalId": 42,
          "status": "PASSED",
          "timestamp": "2026-06-23T00:00:00.000Z",
          "tokenAddress": "CTOKEN_SNAP_001",
          "txHash": "tx_snap_proposal_001",
        }
      `);
    });

    it("null previousStatus is preserved in serialised shape", async () => {
      const raw = await emitAndCollect(
        bus,
        SUBSCRIPTION_TOPICS.proposalStatusChanged,
        { ...payload, previousStatus: null }
      );
      const resolved = resolvers.Subscription.proposalStatusChanged.resolve(raw);

      expect(resolved.previousStatus).toBeNull();
    });
  });

  // ── vaultMatured ───────────────────────────────────────────────────────────

  describe("vaultMatured", () => {
    const payload: VaultMaturedPayload = {
      creatorAddress: "GCREATOR_SNAP_001",
      vaultId: 7,
      recipientAddress: "GRECIPIENT_SNAP_001",
      amount: BigInt("250000000"),
      txHash: "tx_snap_vault_001",
      timestamp: "2026-06-23T00:00:00.000Z",
    };

    it("emitted payload matches schema v1 snapshot", async () => {
      const raw = await emitAndCollect(bus, SUBSCRIPTION_TOPICS.vaultMatured, payload);
      const resolved = resolvers.Subscription.vaultMatured.resolve(raw);

      expect(resolved).toMatchInlineSnapshot(`
        {
          "amount": "250000000",
          "creatorAddress": "GCREATOR_SNAP_001",
          "recipientAddress": "GRECIPIENT_SNAP_001",
          "timestamp": "2026-06-23T00:00:00.000Z",
          "txHash": "tx_snap_vault_001",
          "vaultId": 7,
        }
      `);
    });

    it("amount BigInt is serialised to string", async () => {
      const raw = await emitAndCollect(bus, SUBSCRIPTION_TOPICS.vaultMatured, {
        ...payload,
        amount: BigInt("1"),
      });
      const resolved = resolvers.Subscription.vaultMatured.resolve(raw);

      expect(typeof resolved.amount).toBe("string");
      expect(resolved.amount).toBe("1");
    });
  });
});
