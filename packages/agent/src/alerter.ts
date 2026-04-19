import { logError } from "./logger.js";

/**
 * Ops alerter — pushes critical agent events to a Discord/Slack-compatible
 * webhook. No-op when TEND_ALERT_WEBHOOK_URL is unset, so local dev stays quiet.
 *
 * Use it for things the operator needs to see *now*:
 *   - agent crash (uncaught exception / unhandled rejection)
 *   - treasury hits "critical" (surplus < 0 — next payout will be skipped)
 *   - fee-claim failures repeating on the same mint (stuck)
 *
 * Debouncing: per-key cooldown prevents alert storms when the same condition
 * triggers every tick (e.g. treasury stays critical for an hour).
 */

const WEBHOOK_URL = process.env.TEND_ALERT_WEBHOOK_URL;
const ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 min per alert key

const lastSent = new Map<string, number>();

export type AlertLevel = "info" | "warn" | "critical";

async function postWebhook(content: string): Promise<void> {
  if (!WEBHOOK_URL) return;
  try {
    // Discord-shaped payload — Slack accepts the same `text` key in its
    // incoming-webhook format if the URL points at Slack.
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, text: content }),
    });
  } catch (err) {
    logError("[alerter] webhook post failed:", err);
  }
}

export async function alert(
  key: string,
  level: AlertLevel,
  message: string
): Promise<void> {
  const now = Date.now();
  const prev = lastSent.get(key) ?? 0;
  if (now - prev < ALERT_COOLDOWN_MS) return;
  lastSent.set(key, now);

  const prefix =
    level === "critical" ? "🚨 CRITICAL" : level === "warn" ? "⚠️ WARN" : "ℹ️ INFO";
  await postWebhook(`${prefix} · tend-agent · ${message}`);
}

/**
 * Clear cooldown for a key — useful when a condition resolves and we want the
 * next recurrence to alert immediately without waiting for the window to pass.
 */
export function clearAlert(key: string): void {
  lastSent.delete(key);
}
