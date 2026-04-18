import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { withStateLock } from "./state";

const AGENT_URL = process.env.TEND_AGENT_URL;
const STATE_PATH = join(homedir(), ".tend", "state.json");

/**
 * Forward a wallet-signed campaign mutation to the live agent.  In local dev
 * (where ~/.tend/state.json exists) we apply the mutation directly via the
 * shared file lock so the UI reacts without a network hop.  On Vercel we
 * proxy to the Render agent which owns the canonical state.
 */
export async function forwardCampaignMutation(
  mint: string,
  action: "pause" | "resume",
  body: unknown
) {
  // Local dev: mutate the on-disk state directly (agent + frontend share the file)
  if (existsSync(STATE_PATH)) {
    const res = await applyLocalMutation(mint, action, body);
    return NextResponse.json(res.body, { status: res.status });
  }

  // Production (Vercel): forward to the agent
  if (!AGENT_URL) {
    return NextResponse.json(
      { error: "Agent URL not configured (TEND_AGENT_URL)" },
      { status: 503 }
    );
  }
  try {
    const res = await fetch(`${AGENT_URL}/campaigns/${mint}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to reach agent" },
      { status: 502 }
    );
  }
}

interface LocalBody {
  type?: string;
  message?: string;
  signature?: string;
  publicKey?: string;
}

async function applyLocalMutation(
  mint: string,
  action: "pause" | "resume",
  raw: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const {
    verifyWalletSignature,
    parseAuthMessage,
    isTimestampFresh,
  } = await import("@tend/shared");

  const body = raw as LocalBody;
  const { type, message, signature, publicKey } = body;

  if (!type || !message || !signature || !publicKey) {
    return {
      status: 400,
      body: { error: "Missing fields: type, message, signature, publicKey" },
    };
  }
  const parsed = parseAuthMessage(message);
  if (!parsed) {
    return { status: 400, body: { error: "Malformed auth message" } };
  }
  if (parsed.action !== action) {
    return { status: 400, body: { error: "Action mismatch" } };
  }
  if (parsed.mint !== mint) {
    return { status: 400, body: { error: "Mint mismatch" } };
  }
  if (parsed.type !== type) {
    return { status: 400, body: { error: "Type mismatch" } };
  }
  if (!isTimestampFresh(parsed.timestampMs)) {
    return { status: 401, body: { error: "Auth message expired" } };
  }
  if (!verifyWalletSignature(message, signature, publicKey)) {
    return { status: 401, body: { error: "Invalid signature" } };
  }

  type Outcome =
    | { ok: true; status: string }
    | { ok: false; httpStatus: number; error: string };
  const ref: { current: Outcome } = {
    current: { ok: false, httpStatus: 500, error: "unknown" },
  };

  await withStateLock((s) => {
    const c = (s.campaigns ?? []).find(
      (x) => x.tokenMint === mint && x.type === type
    );
    if (!c) {
      ref.current = { ok: false, httpStatus: 404, error: "Campaign not found" };
      return;
    }
    if (c.creatorWallet !== publicKey) {
      ref.current = {
        ok: false,
        httpStatus: 403,
        error: "Signer is not the campaign creator",
      };
      return;
    }
    if (action === "pause") {
      if (c.status === "paused") {
        ref.current = { ok: true, status: c.status };
        return;
      }
      c.status = "paused";
    } else {
      if (c.status === "live") {
        ref.current = { ok: true, status: c.status };
        return;
      }
      const remaining =
        BigInt(c.poolCapLamports) - BigInt(c.poolSpentLamports);
      c.status = remaining >= 100_000n ? "live" : "depleted";
    }
    ref.current = { ok: true, status: c.status };
  });

  const outcome = ref.current;
  if (!outcome.ok) {
    return { status: outcome.httpStatus, body: { error: outcome.error } };
  }
  return { status: 200, body: { ok: true, status: outcome.status } };
}
