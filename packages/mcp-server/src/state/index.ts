import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  TendState,
  ManagedToken,
  ActiveService,
  WalletEntry,
  FeeSnapshot,
} from "@tend/shared";
import { TEND_STATE_DIR, TEND_STATE_FILE, TEND_WALLETS_FILE } from "@tend/shared";
import { generateKeypair } from "@tend/shared";

const TEND_DIR = join(homedir(), TEND_STATE_DIR);
const STATE_PATH = join(TEND_DIR, TEND_STATE_FILE);
const WALLETS_PATH = join(TEND_DIR, TEND_WALLETS_FILE);

const WALLET_POOL_SIZE = 20;

export class StateManager {
  private state: TendState = {
    managedTokens: {},
    walletPool: [],
    snapshots: [],
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

    // Load or create wallet pool
    if (existsSync(WALLETS_PATH)) {
      const raw = await readFile(WALLETS_PATH, "utf-8");
      this.state.walletPool = JSON.parse(raw);
    } else {
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
    await writeFile(WALLETS_PATH, JSON.stringify(wallets, null, 2));
  }

  private async save(): Promise<void> {
    await writeFile(STATE_PATH, JSON.stringify(this.state, null, 2));
  }

  // ──── Token Management ────

  getManagedToken(tokenMint: string): ManagedToken | undefined {
    return this.state.managedTokens[tokenMint];
  }

  getAllManagedTokens(): ManagedToken[] {
    return Object.values(this.state.managedTokens);
  }

  async addManagedToken(token: ManagedToken): Promise<void> {
    this.state.managedTokens[token.tokenMint] = token;
    await this.save();
  }

  async updateManagedToken(token: ManagedToken): Promise<void> {
    this.state.managedTokens[token.tokenMint] = token;
    await this.save();
  }

  async removeManagedToken(tokenMint: string): Promise<void> {
    delete this.state.managedTokens[tokenMint];
    await this.save();
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
    const token = this.state.managedTokens[tokenMint];
    if (!token) throw new Error(`Token ${tokenMint} not managed`);
    token.services.push(service);
    token.totalServiceBps = token.services.reduce((sum, s) => sum + s.bps, 0);
    token.creatorBps = 10_000 - token.totalServiceBps;
    await this.save();
  }

  async removeService(
    tokenMint: string,
    serviceId: string
  ): Promise<ActiveService | undefined> {
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
    await writeFile(WALLETS_PATH, JSON.stringify(this.state.walletPool, null, 2));
    return removed;
  }

  async removeAllServices(tokenMint: string): Promise<ActiveService[]> {
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
    await writeFile(WALLETS_PATH, JSON.stringify(this.state.walletPool, null, 2));
    return removed;
  }

  // ──── Wallet Pool ────

  assignWallet(serviceId: string, tokenMint: string): WalletEntry | undefined {
    const available = this.state.walletPool.find((w) => !w.assignedTo);
    if (!available) return undefined;
    available.assignedTo = `${serviceId}:${tokenMint}`;
    return available;
  }

  getWalletForService(
    serviceId: string,
    tokenMint: string
  ): WalletEntry | undefined {
    return this.state.walletPool.find(
      (w) => w.assignedTo === `${serviceId}:${tokenMint}`
    );
  }

  getAssignedWallets(): WalletEntry[] {
    return this.state.walletPool.filter((w) => w.assignedTo);
  }

  // ──── Snapshots ────

  async addSnapshot(snapshot: FeeSnapshot): Promise<void> {
    this.state.snapshots.push(snapshot);
    // Keep last 100 snapshots
    if (this.state.snapshots.length > 100) {
      this.state.snapshots = this.state.snapshots.slice(-100);
    }
    await this.save();
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
    const service = this.getActiveService(tokenMint, serviceId);
    if (!service) return;
    Object.assign(service.stats, update);
    await this.save();
  }
}
