import type { ManagedToken, ActiveService } from "@tend/shared";
import { BagsClient, TOTAL_BPS, WSOL_MINT_STR, formatSol, loadKeypair } from "@tend/shared";
import { StateManager } from "../state/index.js";
import { getService } from "../state/service-registry.js";

export class FeeShareOrchestrator {
  constructor(
    private bags: BagsClient,
    private state: StateManager
  ) {}

  async addServiceToToken(
    tokenMint: string,
    serviceId: string,
    bps?: number
  ): Promise<{ service: ActiveService; signatures: string[] }> {
    const serviceDef = getService(serviceId);
    if (!serviceDef) throw new Error(`Service "${serviceId}" not found`);
    if (serviceDef.status !== "available")
      throw new Error(`Service "${serviceId}" is not yet available`);

    const allocatedBps = bps ?? serviceDef.defaultBps;
    if (allocatedBps < serviceDef.minBps || allocatedBps > serviceDef.maxBps) {
      throw new Error(
        `BPS ${allocatedBps} out of range [${serviceDef.minBps}, ${serviceDef.maxBps}]`
      );
    }

    // Get or create managed token
    let token = this.state.getManagedToken(tokenMint);
    if (!token) {
      // Verify we're admin
      const adminMints = await this.bags.getAdminTokenMints();
      if (!adminMints.includes(tokenMint)) {
        throw new Error(
          `Wallet is not admin for token ${tokenMint}. You must be the fee-share admin to add services.`
        );
      }

      token = {
        tokenMint,
        adminWallet: this.bags.keypair.publicKey.toBase58(),
        services: [],
        creatorBps: TOTAL_BPS,
        totalServiceBps: 0,
        lifetimeFees: "0",
        createdAt: Date.now(),
      };
      await this.state.addManagedToken(token);
    }

    // Check existing service
    if (token.services.some((s) => s.serviceId === serviceId)) {
      throw new Error(`Service "${serviceId}" already active on this token`);
    }

    // Check BPS capacity
    if (token.totalServiceBps + allocatedBps > TOTAL_BPS) {
      throw new Error(
        `Cannot allocate ${allocatedBps} BPS. Only ${TOTAL_BPS - token.totalServiceBps} BPS available.`
      );
    }

    // Assign a wallet from the pool
    const wallet = this.state.assignWallet(serviceId, tokenMint);
    if (!wallet) {
      throw new Error("No available wallets in pool. All 20 slots are in use.");
    }

    const service: ActiveService = {
      serviceId,
      tokenMint,
      bps: allocatedBps,
      activatedAt: Date.now(),
      config: {},
      status: "active",
      claimerWallet: wallet.publicKey,
      stats: {
        totalFeesEarned: "0",
        totalFeesClaimed: "0",
        actionsPerformed: 0,
      },
    };

    // Build the full claimers array
    await this.state.addService(tokenMint, service);
    token = this.state.getManagedToken(tokenMint)!;

    // Sync fee config on-chain
    const claimers = this.buildClaimersArray(token);
    const signatures = await this.bags.updateFeeShareConfig(
      tokenMint,
      claimers
    );

    return { service, signatures };
  }

  async removeServiceFromToken(
    tokenMint: string,
    serviceId: string
  ): Promise<{ removed: ActiveService; signatures: string[] }> {
    const removed = await this.state.removeService(tokenMint, serviceId);
    if (!removed)
      throw new Error(`Service "${serviceId}" not found on token ${tokenMint}`);

    const token = this.state.getManagedToken(tokenMint);
    if (!token) throw new Error("Token no longer managed");

    // Sync fee config on-chain
    const claimers = this.buildClaimersArray(token);
    const signatures = await this.bags.updateFeeShareConfig(
      tokenMint,
      claimers
    );

    return { removed, signatures };
  }

  async emergencyStop(
    tokenMint: string
  ): Promise<{ removed: ActiveService[]; signatures: string[] }> {
    const removedServices = await this.state.removeAllServices(tokenMint);
    if (removedServices.length === 0) {
      throw new Error("No services to remove");
    }

    const token = this.state.getManagedToken(tokenMint)!;
    const claimers = this.buildClaimersArray(token);
    const signatures = await this.bags.updateFeeShareConfig(
      tokenMint,
      claimers
    );

    return { removed: removedServices, signatures };
  }

  async rebalanceAllocations(
    tokenMint: string,
    allocations: Array<{ serviceId: string; bps: number }>
  ): Promise<string[]> {
    const token = this.state.getManagedToken(tokenMint);
    if (!token) throw new Error(`Token ${tokenMint} not managed`);

    // Validate all services exist
    for (const alloc of allocations) {
      const service = token.services.find((s) => s.serviceId === alloc.serviceId);
      if (!service)
        throw new Error(`Service "${alloc.serviceId}" not active on this token`);

      const serviceDef = getService(alloc.serviceId);
      if (serviceDef && (alloc.bps < serviceDef.minBps || alloc.bps > serviceDef.maxBps)) {
        throw new Error(
          `BPS ${alloc.bps} for "${alloc.serviceId}" out of range [${serviceDef.minBps}, ${serviceDef.maxBps}]`
        );
      }
    }

    const totalNewBps = allocations.reduce((sum, a) => sum + a.bps, 0);
    if (totalNewBps > TOTAL_BPS) {
      throw new Error(`Total service BPS ${totalNewBps} exceeds ${TOTAL_BPS}`);
    }

    // Apply new allocations
    for (const alloc of allocations) {
      const service = token.services.find((s) => s.serviceId === alloc.serviceId)!;
      service.bps = alloc.bps;
    }
    token.totalServiceBps = token.services.reduce((sum, s) => sum + s.bps, 0);
    token.creatorBps = TOTAL_BPS - token.totalServiceBps;
    await this.state.updateManagedToken(token);

    // Sync on-chain
    const claimers = this.buildClaimersArray(token);
    return this.bags.updateFeeShareConfig(tokenMint, claimers);
  }

  async claimServiceFees(
    tokenMint: string,
    serviceId?: string
  ): Promise<Array<{ serviceId: string; signatures: string[] }>> {
    const token = this.state.getManagedToken(tokenMint);
    if (!token) throw new Error(`Token ${tokenMint} not managed`);

    const servicesToClaim = serviceId
      ? token.services.filter((s) => s.serviceId === serviceId)
      : token.services;

    const results: Array<{ serviceId: string; signatures: string[] }> = [];

    for (const service of servicesToClaim) {
      const wallet = this.state.getWalletForService(
        service.serviceId,
        tokenMint
      );
      if (!wallet) continue;

      const claimerKeypair = loadKeypair(wallet.secretKey);
      const signatures = await this.bags.claimFees(tokenMint, claimerKeypair);

      if (signatures.length > 0) {
        await this.state.updateServiceStats(tokenMint, service.serviceId, {
          lastClaimAt: Date.now(),
        });
      }

      results.push({ serviceId: service.serviceId, signatures });
    }

    return results;
  }

  private buildClaimersArray(
    token: ManagedToken
  ): Array<{ wallet: string; bps: number }> {
    const claimers: Array<{ wallet: string; bps: number }> = [];

    // Creator gets their share
    if (token.creatorBps > 0) {
      claimers.push({
        wallet: token.adminWallet,
        bps: token.creatorBps,
      });
    }

    // Active services
    for (const service of token.services) {
      if (service.status === "active") {
        claimers.push({
          wallet: service.claimerWallet,
          bps: service.bps,
        });
      }
    }

    return claimers;
  }
}
