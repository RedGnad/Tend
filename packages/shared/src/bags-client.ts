import {
  Connection,
  Keypair,
  PublicKey,
  type Commitment,
} from "@solana/web3.js";
import { BagsSDK, signAndSendTransaction } from "@bagsfm/bags-sdk";
import type {
  TokenLaunchCreator,
  TokenLaunchCreatorV3WithClaimStats,
  TokenClaimEvent,
  TradeQuoteResponse,
  CreateSwapTransactionResult,
  BagsTokenLeaderBoardItem,
} from "@bagsfm/bags-sdk";

// BagsClaimablePosition is not re-exported from top-level, infer from method
type BagsClaimablePosition = Awaited<
  ReturnType<InstanceType<typeof BagsSDK>["fee"]["getAllClaimablePositions"]>
>[number];
import { WSOL_MINT } from "./constants.js";

export interface BagsClientConfig {
  apiKey: string;
  rpcUrl: string;
  privateKey: Keypair;
  commitment?: Commitment;
}

export class BagsClient {
  readonly sdk: BagsSDK;
  readonly connection: Connection;
  readonly keypair: Keypair;

  constructor(config: BagsClientConfig) {
    this.connection = new Connection(config.rpcUrl, {
      commitment: config.commitment ?? "processed",
    });
    this.keypair = config.privateKey;
    this.sdk = new BagsSDK(
      config.apiKey,
      this.connection,
      config.commitment ?? "processed"
    );
  }

  // ──── Fee Share Admin ────

  async getAdminTokenMints(): Promise<string[]> {
    return this.sdk.feeShareAdmin.getAdminTokenMints(
      this.keypair.publicKey
    );
  }

  async updateFeeShareConfig(
    tokenMint: string,
    claimers: Array<{ wallet: string; bps: number }>
  ): Promise<string[]> {
    const feeClaimers = claimers.map((c) => ({
      user: new PublicKey(c.wallet),
      userBps: c.bps,
    }));

    // Check if we need LUTs (>7 claimers)
    if (claimers.length > 7) {
      const lutResult =
        await this.sdk.feeShareAdmin.getUpdateConfigLookupTableTransactions({
          feeClaimers,
          payer: this.keypair.publicKey,
        });
      if (lutResult) {
        // Sign and send LUT creation
        const lutSig = await signAndSendTransaction(
          this.connection,
          this.connection.commitment as Commitment ?? "processed",
          lutResult.creationTransaction,
          this.keypair
        );
        // Send extend txs
        for (const extTx of lutResult.extendTransactions) {
          await signAndSendTransaction(
            this.connection,
            this.connection.commitment as Commitment ?? "processed",
            extTx,
            this.keypair
          );
        }
      }
    }

    const txResults =
      await this.sdk.feeShareAdmin.getUpdateConfigTransactions({
        feeClaimers,
        payer: this.keypair.publicKey,
        baseMint: new PublicKey(tokenMint),
      });

    const signatures: string[] = [];
    for (const { transaction, blockhash } of txResults) {
      const sig = await signAndSendTransaction(
        this.connection,
        this.connection.commitment as Commitment ?? "processed",
        transaction,
        this.keypair,
        blockhash
      );
      signatures.push(sig);
    }
    return signatures;
  }

  async createFeeShareConfig(
    tokenMint: string,
    claimers: Array<{ wallet: string; bps: number }>,
    admin?: string
  ): Promise<{ signatures: string[]; configKey: string }> {
    const feeClaimers = claimers.map((c) => ({
      user: new PublicKey(c.wallet),
      userBps: c.bps,
    }));

    const result = await this.sdk.config.createBagsFeeShareConfig({
      feeClaimers,
      payer: this.keypair.publicKey,
      baseMint: new PublicKey(tokenMint),
      admin: admin ? new PublicKey(admin) : this.keypair.publicKey,
    });

    const signatures: string[] = [];

    // Send bundles if any
    for (const bundle of result.bundles) {
      for (const tx of bundle) {
        const sig = await signAndSendTransaction(
          this.connection,
          this.connection.commitment as Commitment ?? "processed",
          tx,
          this.keypair
        );
        signatures.push(sig);
      }
    }

    // Send remaining transactions
    for (const tx of result.transactions) {
      const sig = await signAndSendTransaction(
        this.connection,
        this.connection.commitment as Commitment ?? "processed",
        tx,
        this.keypair
      );
      signatures.push(sig);
    }

    return {
      signatures,
      configKey: result.meteoraConfigKey.toBase58(),
    };
  }

  // ──── Fee Claims ────

  async getClaimablePositions(
    wallet?: PublicKey
  ): Promise<BagsClaimablePosition[]> {
    return this.sdk.fee.getAllClaimablePositions(
      wallet ?? this.keypair.publicKey
    );
  }

  async claimFees(
    tokenMint: string,
    claimerKeypair?: Keypair
  ): Promise<string[]> {
    const kp = claimerKeypair ?? this.keypair;
    const txs = await this.sdk.fee.getClaimTransactions(
      kp.publicKey,
      new PublicKey(tokenMint)
    );

    const signatures: string[] = [];
    for (const tx of txs) {
      // Legacy Transaction — need to sign differently
      tx.sign(kp);
      const sig = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      await this.connection.confirmTransaction(sig, "confirmed");
      signatures.push(sig);
    }
    return signatures;
  }

  // ──── Analytics / State ────

  async getTokenLifetimeFees(tokenMint: string): Promise<number> {
    return this.sdk.state.getTokenLifetimeFees(new PublicKey(tokenMint));
  }

  async getTokenCreators(tokenMint: string): Promise<TokenLaunchCreator[]> {
    return this.sdk.state.getTokenCreators(new PublicKey(tokenMint));
  }

  async getTokenClaimStats(
    tokenMint: string
  ): Promise<TokenLaunchCreatorV3WithClaimStats[]> {
    return this.sdk.state.getTokenClaimStats(new PublicKey(tokenMint));
  }

  async getTokenClaimEvents(
    tokenMint: string,
    options?: { limit?: number; offset?: number }
  ): Promise<TokenClaimEvent[]> {
    return this.sdk.state.getTokenClaimEvents(
      new PublicKey(tokenMint),
      options
    );
  }

  async getTopTokensByLifetimeFees(): Promise<BagsTokenLeaderBoardItem[]> {
    return this.sdk.state.getTopTokensByLifetimeFees();
  }

  // ──── Trading ────

  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<TradeQuoteResponse> {
    return this.sdk.trade.getQuote({
      inputMint: new PublicKey(inputMint),
      outputMint: new PublicKey(outputMint),
      amount,
      slippageMode: "auto",
    });
  }

  async executeSwap(
    inputMint: string,
    outputMint: string,
    amount: number,
    signerKeypair?: Keypair
  ): Promise<{ signature: string; result: CreateSwapTransactionResult }> {
    const kp = signerKeypair ?? this.keypair;
    const quote = await this.getQuote(inputMint, outputMint, amount);
    const result = await this.sdk.trade.createSwapTransaction({
      quoteResponse: quote,
      userPublicKey: kp.publicKey,
    });

    const sig = await signAndSendTransaction(
      this.connection,
      this.connection.commitment as Commitment ?? "processed",
      result.transaction,
      kp
    );

    return { signature: sig, result };
  }

  // ──── Token Launch ────

  async createTokenInfo(params: {
    name: string;
    symbol: string;
    description: string;
    imageUrl: string;
    twitter?: string;
    website?: string;
    telegram?: string;
  }) {
    return this.sdk.tokenLaunch.createTokenInfoAndMetadata({
      name: params.name,
      symbol: params.symbol,
      description: params.description,
      imageUrl: params.imageUrl,
      twitter: params.twitter,
      website: params.website,
      telegram: params.telegram,
    });
  }

  async launchToken(params: {
    metadataUrl: string;
    tokenMint: PublicKey;
    initialBuyLamports: number;
    configKey: PublicKey;
  }): Promise<string> {
    const tx = await this.sdk.tokenLaunch.createLaunchTransaction({
      metadataUrl: params.metadataUrl,
      tokenMint: params.tokenMint,
      launchWallet: this.keypair.publicKey,
      initialBuyLamports: params.initialBuyLamports,
      configKey: params.configKey,
    });

    return signAndSendTransaction(
      this.connection,
      this.connection.commitment as Commitment ?? "processed",
      tx,
      this.keypair
    );
  }
}
