import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  TendState,
  ManagedToken,
  ActiveService,
  WalletEntry,
  FeeSnapshot,
  AgentDecision,
  AnalyticsReport,
  AllocationRecommendation,
} from "@tend/shared";
import { TEND_STATE_DIR, TEND_STATE_FILE } from "@tend/shared";
import { generateKeypair, encryptSecret, decryptSecret, isEncrypted } from "@tend/shared";

const TEND_DIR = join(homedir(), TEND_STATE_DIR);
const STATE_PATH = join(TEND_DIR, TEND_STATE_FILE);
const LEGACY_WALLETS_PATH = join(TEND_DIR, "wallets.json");

const WALLET_POOL_SIZE = 20;

// Simple async mutex to prevent concurrent read-modify-write on state.json
let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let resolve: () => void;
  writeLock = new Promise<void>((r) => { resolve = r; });
  return prev.then(fn).finally(() => resolve!());
}

export class StateManager {
  private state: TendState = {
    managedTokens: {},
    walletPool: [],
    snapshots: [],
    decisions: [],
    reports: [],
    allocations: [],
  };
  private loaded = false;

  async init(): Promise<void> {
    if (!existsSync(TEND_DIR)) {
      await mkdir(TEND_DIR, { recursive: true });
    }

    // Load state
    if (existsSync(STATE_PATH)) {
      const raw = await readFile(STATE_PATH, "utf-8");
      this.state = JSON.parse(raw);
    }

    // Decrypt wallet secrets for in-memory use
    for (const w of this.state.walletPool) {
      if (isEncrypted(w.secretKey)) {
        w.secretKey = decryptSecret(w.secretKey);
      }
    }

    // Ensure arrays exist (migration from older state files)
    if (!this.state.decisions) this.state.decisions = [];
    if (!this.state.reports) this.state.reports = [];
    if (!this.state.allocations) this.state.allocations = [];

    // ── Migration: merge legacy wallets.json into state.walletPool ──
    if (existsSync(LEGACY_WALLETS_PATH)) {
      try {
        const raw = await readFile(LEGACY_WALLETS_PATH, "utf-8");
        const legacyWallets: WalletEntry[] = JSON.parse(raw);
        // Merge: for each legacy wallet, add if not already in pool
        const existingKeys = new Set(this.state.walletPool.map((w) => w.publicKey));
        for (const lw of legacyWallets) {
          if (!existingKeys.has(lw.publicKey)) {
            this.state.walletPool.push(lw);
          } else {
            // Preserve assignedTo from legacy if state version is unassigned
            const existing = this.state.walletPool.find((w) => w.publicKey === lw.publicKey);
            if (existing && !existing.assignedTo && lw.assignedTo) {
              existing.assignedTo = lw.assignedTo;
            }
          }
        }
        await this.save();
        // Remove legacy file
        await unlink(LEGACY_WALLETS_PATH);
        console.error("[state] Migrated wallets.json into state.json and removed legacy file");
      } catch {
        console.error("[state] Warning: could not migrate wallets.json");
      }
    }

    // ── Migration: merge legacy serviceWallets into walletPool ──
    if (this.state.serviceWallets && Object.keys(this.state.serviceWallets).length > 0) {
      const existingKeys = new Set(this.state.walletPool.map((w) => w.publicKey));
      for (const [pubkey, secret] of Object.entries(this.state.serviceWallets)) {
        if (!existingKeys.has(pubkey)) {
          // Find which service uses this wallet
          let assignedTo: string | undefined;
          for (const token of Object.values(this.state.managedTokens)) {
            const svc = token.services.find((s) => s.claimerWallet === pubkey);
            if (svc) {
              assignedTo = `${svc.serviceId}:${token.tokenMint}`;
              break;
            }
          }
          this.state.walletPool.push({ publicKey: pubkey, secretKey: secret, assignedTo });
          existingKeys.add(pubkey);
        }
      }
      delete this.state.serviceWallets;
      await this.save();
      console.error("[state] Migrated serviceWallets into walletPool");
    }

    // Generate wallet pool if empty
    if (this.state.walletPool.length === 0) {
      await this.generateWalletPool();
    }

    this.loaded = true;
  }

  private async generateWalletPool(): Promise<void> {
    const wallets: WalletEntry[] = [];
    for (let i = 0; i < WALLET_POOL_SIZE; i++) {
      const kp = generateKeypair();
      wallets.push({
        publicKey: kp.publicKey,
        secretKey: kp.secretKey,
      });
    }
    this.state.walletPool = wallets;
    await this.save();
  }

  private async save(): Promise<void> {
    // Encrypt wallet secrets before persisting
    const stateToWrite = {
      ...this.state,
      walletPool: this.state.walletPool.map((w) => ({
        ...w,
        secretKey: isEncrypted(w.secretKey) ? w.secretKey : encryptSecret(w.secretKey),
      })),
    };
    await writeFile(STATE_PATH, JSON.stringify(stateToWrite, null, 2));
  }

  // ──── Token Management ────

  getManagedToken(tokenMint: string): ManagedToken | undefined {
    return this.state.managedTokens[tokenMint];
  }

  getAllManagedTokens(): ManagedToken[] {
    return Object.values(this.state.managedTokens);
  }

  async addManagedToken(token: ManagedToken): Promise<void> {
    return withLock(async () => {
      this.state.managedTokens[token.tokenMint] = token;
      await this.save();
    });
  }

  async updateManagedToken(token: ManagedToken): Promise<void> {
    return withLock(async () => {
      this.state.managedTokens[token.tokenMint] = token;
      await this.save();
    });
  }

  async removeManagedToken(tokenMint: string): Promise<void> {
    return withLock(async () => {
      delete this.state.managedTokens[tokenMint];
      await this.save();
    });
  }

  // ──── Service Management ────

  getActiveService(
    tokenMint: string,
    serviceId: string
  ): ActiveService | undefined {
    const token = this.getManagedToken(tokenMint);
    return token?.services.find((s) => s.serviceId === serviceId);
  }

  async addService(
    tokenMint: string,
    service: ActiveService
  ): Promise<void> {
    return withLock(async () => {
      const token = this.state.managedTokens[tokenMint];
      if (!token) throw new Error(`Token ${tokenMint} not managed`);
      token.services.push(service);
      token.totalServiceBps = token.services.reduce((sum, s) => sum + s.bps, 0);
      token.creatorBps = 10_000 - token.totalServiceBps;
      await this.save();
    });
  }

  async removeService(
    tokenMint: string,
    serviceId: string
  ): Promise<ActiveService | undefined> {
    return withLock(async () => {
      const token = this.state.managedTokens[tokenMint];
      if (!token) return undefined;
      const idx = token.services.findIndex((s) => s.serviceId === serviceId);
      if (idx === -1) return undefined;
      const [removed] = token.services.splice(idx, 1);
      token.totalServiceBps = token.services.reduce((sum, s) => sum + s.bps, 0);
      token.creatorBps = 10_000 - token.totalServiceBps;

      // Free the wallet
      const walletEntry = this.state.walletPool.find(
        (w) => w.publicKey === removed.claimerWallet
      );
      if (walletEntry) {
        walletEntry.assignedTo = undefined;
      }

      await this.save();
      return removed;
    });
  }

  async removeAllServices(tokenMint: string): Promise<ActiveService[]> {
    return withLock(async () => {
      const token = this.state.managedTokens[tokenMint];
      if (!token) return [];
      const removed = [...token.services];
      token.services = [];
      token.totalServiceBps = 0;
      token.creatorBps = 10_000;

      // Free all wallets
      for (const service of removed) {
        const walletEntry = this.state.walletPool.find(
          (w) => w.publicKey === service.claimerWallet
        );
        if (walletEntry) {
          walletEntry.assignedTo = undefined;
        }
      }

      await this.save();
      return removed;
    });
  }

  // ──── Wallet Pool ────

  async assignWallet(serviceId: string, tokenMint: string): Promise<WalletEntry | undefined> {
    return withLock(async () => {
      const available = this.state.walletPool.find((w) => !w.assignedTo);
      if (!available) return undefined;
      available.assignedTo = `${serviceId}:${tokenMint}`;
      await this.save();
      return available;
    });
  }

  getWalletForService(
    serviceId: string,
    tokenMint: string
  ): WalletEntry | undefined {
    return this.state.walletPool.find(
      (w) => w.assignedTo === `${serviceId}:${tokenMint}`
    );
  }

  getWalletByPublicKey(publicKey: string): WalletEntry | undefined {
    return this.state.walletPool.find((w) => w.publicKey === publicKey);
  }

  getAssignedWallets(): WalletEntry[] {
    return this.state.walletPool.filter((w) => w.assignedTo);
  }

  // ──── Add wallet to pool (for dashboard-created service wallets) ────

  async addWalletToPool(wallet: WalletEntry): Promise<void> {
    return withLock(async () => {
      const exists = this.state.walletPool.find((w) => w.publicKey === wallet.publicKey);
      if (!exists) {
        this.state.walletPool.push(wallet);
        await this.save();
      }
    });
  }

  // ──── Snapshots ────

  async addSnapshot(snapshot: FeeSnapshot): Promise<void> {
    return withLock(async () => {
      this.state.snapshots.push(snapshot);
      if (this.state.snapshots.length > 100) {
        this.state.snapshots = this.state.snapshots.slice(-100);
      }
      await this.save();
    });
  }

  getSnapshots(tokenMint: string): FeeSnapshot[] {
    return this.state.snapshots.filter((s) => s.tokenMint === tokenMint);
  }

  // ──── Stats Update ────

  async updateServiceStats(
    tokenMint: string,
    serviceId: string,
    update: Partial<ActiveService["stats"]>
  ): Promise<void> {
    return withLock(async () => {
      const service = this.getActiveService(tokenMint, serviceId);
      if (!service) return;
      Object.assign(service.stats, update);
      await this.save();
    });
  }

  // ──── Decision Log ────

  async addDecision(decision: AgentDecision): Promise<void> {
    return withLock(async () => {
      if (!this.state.decisions) this.state.decisions = [];
      this.state.decisions.push(decision);
      if (this.state.decisions.length > 200) {
        this.state.decisions = this.state.decisions.slice(-200);
      }
      await this.save();
    });
  }

  getDecisions(tokenMint?: string, limit = 20): AgentDecision[] {
    const all = this.state.decisions ?? [];
    const filtered = tokenMint
      ? all.filter((d) => d.tokenMint === tokenMint)
      : all;
    return filtered.slice(-limit).reverse();
  }

  // ──── Analytics Reports ────

  async addReport(report: AnalyticsReport): Promise<void> {
    return withLock(async () => {
      if (!this.state.reports) this.state.reports = [];
      this.state.reports.push(report);
      if (this.state.reports.length > 50) {
        this.state.reports = this.state.reports.slice(-50);
      }
      await this.save();
    });
  }

  getReports(tokenMint?: string, limit = 10): AnalyticsReport[] {
    const all = this.state.reports ?? [];
    const filtered = tokenMint
      ? all.filter((r) => r.tokenMint === tokenMint)
      : all;
    return filtered.slice(-limit).reverse();
  }

  // ──── Allocation Recommendations ────

  async addAllocation(rec: AllocationRecommendation): Promise<void> {
    return withLock(async () => {
      if (!this.state.allocations) this.state.allocations = [];
      this.state.allocations.push(rec);
      if (this.state.allocations.length > 20) {
        this.state.allocations = this.state.allocations.slice(-20);
      }
      await this.save();
    });
  }

  getAllocations(tokenMint?: string, limit = 5): AllocationRecommendation[] {
    const all = this.state.allocations ?? [];
    const filtered = tokenMint
      ? all.filter((a) => a.tokenMint === tokenMint)
      : all;
    return filtered.slice(-limit).reverse();
  }
}
