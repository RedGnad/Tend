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

    // Build claimers array with the new service included
    const pendingToken = {
      ...token,
      services: [...token.services, service],
      totalServiceBps: token.totalServiceBps + allocatedBps,
      creatorBps: token.creatorBps - allocatedBps,
    };
    const claimers = this.buildClaimersArray(pendingToken);

    // Sync fee config on-chain FIRST — if this fails, state is untouched
    const signatures = await this.bags.updateFeeShareConfig(
      tokenMint,
      claimers
    );

    // Only persist to state after on-chain success
    await this.state.addService(tokenMint, service);

    return { service, signatures };
  }

  async removeServiceFromToken(
    tokenMint: string,
    serviceId: string
  ): Promise<{ removed: ActiveService; signatures: string[] }> {
    const token = this.state.getManagedToken(tokenMint);
    if (!token) throw new Error(`Token ${tokenMint} not managed`);

    const serviceToRemove = token.services.find((s) => s.serviceId === serviceId);
    if (!serviceToRemove)
      throw new Error(`Service "${serviceId}" not found on token ${tokenMint}`);

    // Build claimers without the service to remove
    const pendingToken = {
      ...token,
      services: token.services.filter((s) => s.serviceId !== serviceId),
      totalServiceBps: token.totalServiceBps - serviceToRemove.bps,
      creatorBps: token.creatorBps + serviceToRemove.bps,
    };
    const claimers = this.buildClaimersArray(pendingToken);

    // Sync on-chain FIRST
    const signatures = await this.bags.updateFeeShareConfig(
      tokenMint,
      claimers
    );

    // Only remove from state after on-chain success
    const removed = await this.state.removeService(tokenMint, serviceId);
    if (!removed) throw new Error("State inconsistency after on-chain update");

    return { removed, signatures };
  }

  async emergencyStop(
    tokenMint: string
  ): Promise<{ removed: ActiveService[]; signatures: string[] }> {
    const token = this.state.getManagedToken(tokenMint);
    if (!token || token.services.length === 0) {
      throw new Error("No services to remove");
    }

    // Build claimers with all services removed (admin gets 100%)
    const pendingToken = {
      ...token,
      services: [],
      totalServiceBps: 0,
      creatorBps: TOTAL_BPS,
    };
    const claimers = this.buildClaimersArray(pendingToken);

    // Sync on-chain FIRST
    const signatures = await this.bags.updateFeeShareConfig(
      tokenMint,
      claimers
    );

    // Only remove from state after on-chain success
    const removedServices = await this.state.removeAllServices(tokenMint);

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

    // Build pending token with new allocations (don't mutate yet)
    const pendingServices = token.services.map((s) => {
      const alloc = allocations.find((a) => a.serviceId === s.serviceId);
      return alloc ? { ...s, bps: alloc.bps } : s;
    });
    const pendingToken = {
      ...token,
      services: pendingServices,
      totalServiceBps: pendingServices.reduce((sum, s) => sum + s.bps, 0),
      creatorBps: TOTAL_BPS - pendingServices.reduce((sum, s) => sum + s.bps, 0),
    };
    const claimers = this.buildClaimersArray(pendingToken);

    // Sync on-chain FIRST
    const signatures = await this.bags.updateFeeShareConfig(tokenMint, claimers);

    // Only persist to state after on-chain success
    await this.state.updateManagedToken(pendingToken);

    return signatures;
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
