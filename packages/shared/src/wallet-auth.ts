import nacl from "tweetnacl";
import bs58 from "bs58";

/**
 * Wallet-signed message protocol for creator-authenticated mutations.
 *
 * Message format: `tend:<action>:<mint>:<type>:<timestampMs>`
 *   e.g. "tend:pause:6qa9oCyp...:holder:1713456789000"
 *
 * The client builds this string, signs it with their connected wallet,
 * and sends { message, signature, publicKey } to the agent.  The agent
 * verifies the signature, checks the timestamp window, and confirms the
 * publicKey matches the campaign's creatorWallet.
 */

export const AUTH_WINDOW_MS = 5 * 60 * 1000;
export const SUPPORTED_ACTIONS = ["pause", "resume", "topup", "create"] as const;
export type AuthAction = (typeof SUPPORTED_ACTIONS)[number];

export interface AuthPayload {
  action: AuthAction;
  mint: string;
  type: string;
  timestampMs: number;
}

export function buildAuthMessage(p: AuthPayload): string {
  return `tend:${p.action}:${p.mint}:${p.type}:${p.timestampMs}`;
}

export function parseAuthMessage(msg: string): AuthPayload | null {
  const parts = msg.split(":");
  if (parts.length !== 5 || parts[0] !== "tend") return null;
  const [, action, mint, type, ts] = parts;
  if (!SUPPORTED_ACTIONS.includes(action as AuthAction)) return null;
  const timestampMs = Number(ts);
  if (!Number.isFinite(timestampMs)) return null;
  return { action: action as AuthAction, mint, type, timestampMs };
}

export function isTimestampFresh(ts: number, windowMs = AUTH_WINDOW_MS): boolean {
  const now = Date.now();
  return Math.abs(now - ts) <= windowMs;
}

export function verifyWalletSignature(
  message: string,
  signatureB58: string,
  publicKeyB58: string
): boolean {
  try {
    const msgBytes = new TextEncoder().encode(message);
    const sigBytes = bs58.decode(signatureB58);
    const pubKeyBytes = bs58.decode(publicKeyB58);
    if (sigBytes.length !== 64 || pubKeyBytes.length !== 32) return false;
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubKeyBytes);
  } catch {
    return false;
  }
}
