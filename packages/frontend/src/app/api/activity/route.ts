import { NextResponse } from "next/server";
import { getBagsClient } from "@/lib/bags-server";
import { getManagedTokens } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tokens = await getManagedTokens();

    if (tokens.length === 0) {
      return NextResponse.json({
        events: [],
        message: "Run agent locally to see activity",
      });
    }

    const bags = getBagsClient();

    // Fetch recent claim events for all managed tokens
    const allEvents = await Promise.all(
      tokens.map(async (token) => {
        try {
          const events = await bags.getTokenClaimEvents(token.tokenMint, {
            limit: 10,
          });
          return events.map((e) => {
            // Check if this is a Tend service wallet
            const service = token.services.find(
              (s) => s.claimerWallet === e.wallet
            );
            return {
              ...e,
              tokenMint: token.tokenMint,
              serviceId: service?.serviceId ?? null,
              isTendService: !!service,
            };
          });
        } catch {
          return [];
        }
      })
    );

    // Flatten and sort by timestamp desc
    const events = allEvents
      .flat()
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 30);

    return NextResponse.json({ events });
  } catch {
    return NextResponse.json({
      events: [],
      message: "Run agent locally to see activity",
    });
  }
}
