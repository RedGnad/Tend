import { describe, it, expect, beforeEach, vi } from "vitest";
import { StateManager } from "../state/index.js";
import type { ManagedToken, ActiveService } from "@tend/shared";

// Mock filesystem
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(new Error("not found")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

function createMockToken(mint = "TokenMint123"): ManagedToken {
  return {
    tokenMint: mint,
    adminWallet: "AdminWallet123",
    services: [],
    creatorBps: 10_000,
    totalServiceBps: 0,
    lifetimeFees: "0",
    createdAt: Date.now(),
  };
}

function createMockService(id = "buyback-bot", bps = 1500): ActiveService {
  return {
    serviceId: id,
    tokenMint: "TokenMint123",
    bps,
    activatedAt: Date.now(),
    claimerWallet: "ServiceWallet123",
    status: "active",
    config: {},
    stats: {
      totalFeesEarned: "0",
      totalFeesClaimed: "0",
      actionsPerformed: 0,
    },
  };
}

describe("StateManager", () => {
  let state: StateManager;

  beforeEach(async () => {
    state = new StateManager();
    await state.init();
  });

  describe("Token Management", () => {
    it("starts with no managed tokens", () => {
      expect(state.getAllManagedTokens()).toHaveLength(0);
    });

    it("adds a managed token", async () => {
      const token = createMockToken();
      await state.addManagedToken(token);
      expect(state.getManagedToken("TokenMint123")).toBeDefined();
      expect(state.getAllManagedTokens()).toHaveLength(1);
    });

    it("retrieves token by mint", async () => {
      await state.addManagedToken(createMockToken("AAA"));
      await state.addManagedToken(createMockToken("BBB"));
      expect(state.getManagedToken("AAA")?.tokenMint).toBe("AAA");
      expect(state.getManagedToken("BBB")?.tokenMint).toBe("BBB");
      expect(state.getManagedToken("CCC")).toBeUndefined();
    });

    it("removes a managed token", async () => {
      await state.addManagedToken(createMockToken());
      await state.removeManagedToken("TokenMint123");
      expect(state.getManagedToken("TokenMint123")).toBeUndefined();
      expect(state.getAllManagedTokens()).toHaveLength(0);
    });
  });

  describe("Service Management", () => {
    beforeEach(async () => {
      await state.addManagedToken(createMockToken());
    });

    it("adds a service and updates BPS", async () => {
      const service = createMockService("buyback-bot", 1500);
      await state.addService("TokenMint123", service);
      const token = state.getManagedToken("TokenMint123")!;
      expect(token.services).toHaveLength(1);
      expect(token.totalServiceBps).toBe(1500);
      expect(token.creatorBps).toBe(8500);
    });

    it("adds multiple services and tracks total BPS", async () => {
      await state.addService("TokenMint123", createMockService("buyback-bot", 1500));
      await state.addService("TokenMint123", createMockService("analytics", 500));
      const token = state.getManagedToken("TokenMint123")!;
      expect(token.services).toHaveLength(2);
      expect(token.totalServiceBps).toBe(2000);
      expect(token.creatorBps).toBe(8000);
    });

    it("removes a service and restores BPS", async () => {
      await state.addService("TokenMint123", createMockService("buyback-bot", 1500));
      await state.addService("TokenMint123", createMockService("analytics", 500));
      const removed = await state.removeService("TokenMint123", "buyback-bot");
      expect(removed?.serviceId).toBe("buyback-bot");
      const token = state.getManagedToken("TokenMint123")!;
      expect(token.services).toHaveLength(1);
      expect(token.totalServiceBps).toBe(500);
      expect(token.creatorBps).toBe(9500);
    });

    it("removeService returns undefined for unknown service", async () => {
      const result = await state.removeService("TokenMint123", "nonexistent");
      expect(result).toBeUndefined();
    });

    it("removeAllServices clears everything", async () => {
      await state.addService("TokenMint123", createMockService("buyback-bot", 1500));
      await state.addService("TokenMint123", createMockService("analytics", 500));
      const removed = await state.removeAllServices("TokenMint123");
      expect(removed).toHaveLength(2);
      const token = state.getManagedToken("TokenMint123")!;
      expect(token.services).toHaveLength(0);
      expect(token.totalServiceBps).toBe(0);
      expect(token.creatorBps).toBe(10_000);
    });

    it("throws when adding service to unmanaged token", async () => {
      await expect(
        state.addService("UNKNOWN", createMockService())
      ).rejects.toThrow("Token UNKNOWN not managed");
    });
  });

  describe("Service Stats", () => {
    it("updates service stats", async () => {
      await state.addManagedToken(createMockToken());
      await state.addService("TokenMint123", createMockService());
      await state.updateServiceStats("TokenMint123", "buyback-bot", {
        totalFeesEarned: "1000000",
        actionsPerformed: 5,
      });
      const service = state.getActiveService("TokenMint123", "buyback-bot")!;
      expect(service.stats.totalFeesEarned).toBe("1000000");
      expect(service.stats.actionsPerformed).toBe(5);
      expect(service.stats.totalFeesClaimed).toBe("0"); // unchanged
    });
  });

  describe("Wallet Pool", () => {
    it("generates wallets on init", () => {
      const assigned = state.getAssignedWallets();
      expect(assigned).toHaveLength(0);
    });

    it("assigns a wallet to a service", () => {
      const wallet = state.assignWallet("buyback-bot", "TokenMint123");
      expect(wallet).toBeDefined();
      expect(wallet!.assignedTo).toBe("buyback-bot:TokenMint123");
    });

    it("retrieves wallet for a service", () => {
      state.assignWallet("buyback-bot", "TokenMint123");
      const wallet = state.getWalletForService("buyback-bot", "TokenMint123");
      expect(wallet).toBeDefined();
      expect(wallet!.assignedTo).toBe("buyback-bot:TokenMint123");
    });
  });

  describe("Snapshots", () => {
    it("adds and retrieves snapshots", async () => {
      await state.addSnapshot({
        tokenMint: "TokenMint123",
        timestamp: Date.now(),
        totalFees24h: "1000000",
        serviceAllocations: [
          { serviceId: "buyback-bot", bps: 1500, earned: "500000" },
        ],
      });
      const snapshots = state.getSnapshots("TokenMint123");
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].totalFees24h).toBe("1000000");
    });

    it("filters snapshots by token", async () => {
      await state.addSnapshot({
        tokenMint: "AAA",
        timestamp: Date.now(),
        totalFees24h: "100",
        serviceAllocations: [],
      });
      await state.addSnapshot({
        tokenMint: "BBB",
        timestamp: Date.now(),
        totalFees24h: "200",
        serviceAllocations: [],
      });
      expect(state.getSnapshots("AAA")).toHaveLength(1);
      expect(state.getSnapshots("BBB")).toHaveLength(1);
      expect(state.getSnapshots("CCC")).toHaveLength(0);
    });
  });
});
