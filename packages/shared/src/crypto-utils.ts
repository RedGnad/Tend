import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const PREFIX = "enc:";

/**
 * Derive a 256-bit key from TEND_PRIVATE_KEY using SHA-256.
 * Falls back to a no-op if no key is set (dev/test environments).
 */
function deriveKey(): Buffer | null {
  const seed = process.env.TEND_PRIVATE_KEY;
  if (!seed) return null;
  return createHash("sha256").update(seed).digest();
}

/** Encrypt a plaintext string. Returns "enc:<iv>:<tag>:<ciphertext>" in hex. */
export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  if (!key) return plaintext; // no key → store in clear (dev mode)

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Decrypt a secret. If it's not prefixed with "enc:", return as-is (legacy/unencrypted). */
export function decryptSecret(value: string): string {
  if (!value.startsWith(PREFIX)) return value; // plaintext / legacy

  const key = deriveKey();
  if (!key) throw new Error("TEND_PRIVATE_KEY required to decrypt wallet secrets");

  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Malformed encrypted secret");

  const [ivHex, tagHex, cipherHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(cipherHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString("utf8");
}

/** Returns true if the value is already encrypted */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}
