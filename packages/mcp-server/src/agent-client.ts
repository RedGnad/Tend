import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type {
  BagsClient,
  Campaign,
  CampaignType,
  FraudDecision,
  RewardPayout,
  SpendingPeriod,
} from "@tend/shared";
import { buildAuthMessage, signWalletMessage } from "@tend/shared";

/**
 * Thin HTTP client that routes every mutating MCP tool through the Tend agent
 * (Render). The agent is the single source of truth for:
 *   - Squads vault provisioning (configAuthority = creator, member = agent key)
 *   - Treasury solvency checks on topup / withdraw paths
 *   - Authoritative state writes (Postgres when flipped, filesystem otherwise)
 *
 * We intentionally never re-implement orchestration logic MCP-side. The tools
 * here just sign auth messages + merged transactions with the local creator
 * key, then hand off to the agent.
 */

export interface ProvisionPreparePayload {
  mergedTx: { transaction: string; blockhash: string };
  multisigCreateKey: string | null;
  multisigPda: string;
  vaultIndex: number;
  vaultPda: string;
  spendingLimitPda: string;
  spendingLimitCreateKey: string;
}

export interface ProvisionCommitResult {
  multisigPda: string;
  vaultPda: string;
  spendingLimitPda: string;
}

export interface TopupResult {
  status: string;
  addedLamports: string;
  depositTxSig: string;
  sweepTxSig: string | null;
}

export class AgentClient {
  readonly agentUrl: string;
  private readonly bags: BagsClient;

  constructor(bags: BagsClient, agentUrl: string) {
    if (!agentUrl) throw new Error("AgentClient: agentUrl is required");
    this.agentUrl = agentUrl.replace(/\/+$/, "");
    this.bags = bags;
  }

  private get connection(): Connection {
    return this.bags.connection;
  }

  private get creator(): Keypair {
    return this.bags.keypair;
  }

  get creatorWallet(): string {
    return this.creator.publicKey.toBase58();
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.agentUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(
        `Agent ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`
      );
    }
    if (!res.ok) {
      const msg =
        (parsed as { error?: string })?.error ??
        `Agent ${path} failed (${res.status})`;
      throw new Error(msg);
    }
    return parsed as T;
  }

  async fetchState(): Promise<{
    campaigns: Campaign[];
    rewardPayouts: RewardPayout[];
    fraudDecisions: FraudDecision[];
    adminWallet?: string;
  }> {
    const res = await fetch(`${this.agentUrl}/state`);
    if (!res.ok) throw new Error(`Agent /state failed (${res.status})`);
    const raw = (await res.json()) as {
      campaigns?: Campaign[];
      rewardPayouts?: RewardPayout[];
      fraudDecisions?: FraudDecision[];
      adminWallet?: string;
    };
    return {
      campaigns: raw.campaigns ?? [],
      rewardPayouts: raw.rewardPayouts ?? [],
      fraudDecisions: raw.fraudDecisions ?? [],
      adminWallet: raw.adminWallet,
    };
  }

  private buildSignedEnvelope(
    action: Parameters<typeof buildAuthMessage>[0]["action"],
    mint: string,
    type: string
  ): { message: string; signature: string; publicKey: string } {
    const message = buildAuthMessage({
      action,
      mint,
      type,
      timestampMs: Date.now(),
    });
    const signature = signWalletMessage(message, this.creator);
    return { message, signature, publicKey: this.creatorWallet };
  }

  /**
   * End-to-end Squads-backed campaign creation:
   *   1. prepare  → agent builds merged tx (createMs? + addSL + fundVault?)
   *   2. sign+send locally with creator key, confirm on-chain
   *   3. confirm  → agent persists state (campaign row with squads* fields)
   */
  async createCampaign(params: {
    tokenMint: string;
    type: CampaignType;
    amountLamports: bigint;
    period: SpendingPeriod;
    initialFundingLamports?: bigint;
    campaignConfig: Record<string, unknown>;
  }): Promise<
    ProvisionCommitResult & {
      mergedTxSig: string;
      vaultIndex: number;
      spendingLimitPda: string;
    }
  > {
    const envelope = this.buildSignedEnvelope(
      "provision-squads",
      params.tokenMint,
      params.type
    );

    const prepared = await this.post<ProvisionPreparePayload & { ok: true }>(
      "/campaigns/provision-squads/prepare",
      {
        ...envelope,
        tokenMint: params.tokenMint,
        type: params.type,
        amountLamports: params.amountLamports.toString(),
        period: params.period,
        initialFundingLamports: params.initialFundingLamports?.toString(),
        campaignConfig: params.campaignConfig,
      }
    );

    const tx = VersionedTransaction.deserialize(
      Buffer.from(prepared.mergedTx.transaction, "base64")
    );
    tx.sign([this.creator]);

    const mergedTxSig = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    const latest = await this.connection.getLatestBlockhash("confirmed");
    const conf = await this.connection.confirmTransaction(
      {
        signature: mergedTxSig,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed"
    );
    if (conf.value.err) {
      throw new Error(
        `Squads provision tx failed on-chain: ${JSON.stringify(conf.value.err)}`
      );
    }

    const committed = await this.post<ProvisionCommitResult & { ok: true }>(
      "/campaigns/provision-squads/confirm",
      {
        ...envelope,
        tokenMint: params.tokenMint,
        type: params.type,
        multisigCreateKey: prepared.multisigCreateKey,
        vaultIndex: prepared.vaultIndex,
        spendingLimitCreateKey: prepared.spendingLimitCreateKey,
        mergedTxSig,
        amountLamports: params.amountLamports.toString(),
        period: params.period,
        campaignConfig: params.campaignConfig,
      }
    );

    return {
      mergedTxSig,
      vaultIndex: prepared.vaultIndex,
      multisigPda: committed.multisigPda,
      vaultPda: committed.vaultPda,
      spendingLimitPda: committed.spendingLimitPda,
    };
  }

  /**
   * Topup a campaign pool. The agent expects the creator to have ALREADY
   * transferred SOL to the Tend admin wallet — we do that here, confirm, then
   * hand the deposit tx sig over for verification + auto-sweep into the vault.
   */
  async topupPool(params: {
    tokenMint: string;
    type: CampaignType;
    addLamports: bigint;
  }): Promise<TopupResult> {
    if (params.addLamports <= 0n) {
      throw new Error("addLamports must be > 0");
    }

    const state = await this.fetchState();
    const adminWalletB58 = state.adminWallet;
    if (!adminWalletB58) {
      throw new Error("Agent /state did not expose adminWallet — cannot route topup");
    }

    const transfer = SystemProgram.transfer({
      fromPubkey: this.creator.publicKey,
      toPubkey: new PublicKey(adminWalletB58),
      lamports: Number(params.addLamports),
    });
    const depositTx = new Transaction().add(transfer);
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash("confirmed");
    depositTx.recentBlockhash = blockhash;
    depositTx.feePayer = this.creator.publicKey;
    depositTx.sign(this.creator);
    const depositTxSig = await this.connection.sendRawTransaction(
      depositTx.serialize(),
      { skipPreflight: false, maxRetries: 3 }
    );
    const conf = await this.connection.confirmTransaction(
      { signature: depositTxSig, blockhash, lastValidBlockHeight },
      "confirmed"
    );
    if (conf.value.err) {
      throw new Error(
        `Deposit tx failed on-chain: ${JSON.stringify(conf.value.err)}`
      );
    }

    const envelope = this.buildSignedEnvelope(
      "topup",
      params.tokenMint,
      params.type
    );

    const result = await this.post<{
      ok: true;
      status: string;
      addedLamports: string;
      sweepTxSig: string | null;
    }>(`/campaigns/${params.tokenMint}/topup`, {
      ...envelope,
      type: params.type,
      txSig: depositTxSig,
    });

    return {
      status: result.status,
      addedLamports: result.addedLamports,
      depositTxSig,
      sweepTxSig: result.sweepTxSig,
    };
  }

  async pauseCampaign(params: {
    tokenMint: string;
    type: CampaignType;
  }): Promise<{ status: string }> {
    const envelope = this.buildSignedEnvelope(
      "pause",
      params.tokenMint,
      params.type
    );
    return this.post<{ status: string }>(
      `/campaigns/${params.tokenMint}/pause`,
      { ...envelope, type: params.type }
    );
  }

  async resumeCampaign(params: {
    tokenMint: string;
    type: CampaignType;
  }): Promise<{ status: string }> {
    const envelope = this.buildSignedEnvelope(
      "resume",
      params.tokenMint,
      params.type
    );
    return this.post<{ status: string }>(
      `/campaigns/${params.tokenMint}/resume`,
      { ...envelope, type: params.type }
    );
  }
}
