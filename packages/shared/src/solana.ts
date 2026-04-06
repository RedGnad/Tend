import {
  Connection,
  Keypair,
  VersionedTransaction,
  type Commitment,
} from "@solana/web3.js";
import bs58 from "bs58";
import { LAMPORTS_PER_SOL } from "./constants.js";

export function loadKeypair(base58Key: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(base58Key));
}

export function createConnection(
  rpcUrl: string,
  commitment: Commitment = "processed"
): Connection {
  return new Connection(rpcUrl, { commitment });
}

export function lamportsToSol(lamports: number | string): number {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

export function solToLamports(sol: number): number {
  return Math.floor(sol * LAMPORTS_PER_SOL);
}

export function formatSol(lamports: number | string, decimals = 4): string {
  return lamportsToSol(lamports).toFixed(decimals) + " SOL";
}

export async function signAndSendVersionedTransaction(
  connection: Connection,
  transaction: VersionedTransaction,
  keypair: Keypair
): Promise<string> {
  transaction.sign([keypair]);
  const signature = await connection.sendTransaction(transaction, {
    skipPreflight: false,
    maxRetries: 3,
  });
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}

export function generateKeypair(): { publicKey: string; secretKey: string } {
  const kp = Keypair.generate();
  return {
    publicKey: kp.publicKey.toBase58(),
    secretKey: bs58.encode(kp.secretKey),
  };
}
