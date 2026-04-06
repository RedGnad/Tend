import type { ServiceDefinition } from "@tend/shared";

export const SERVICE_REGISTRY: ServiceDefinition[] = [
  {
    id: "buyback-bot",
    name: "Buyback Bot",
    description:
      "Automatically claims fees and buys back the token, creating sustained buy pressure. Configurable frequency and minimum amounts.",
    defaultBps: 1500,
    minBps: 500,
    maxBps: 4000,
    category: "market-making",
    status: "available",
  },
  {
    id: "fee-compounder",
    name: "Fee Compounder",
    description:
      "Claims accumulated fees and reinvests into liquidity positions. Maximizes yield on idle fee revenue.",
    defaultBps: 1000,
    minBps: 300,
    maxBps: 3000,
    category: "growth",
    status: "available",
  },
  {
    id: "analytics",
    name: "Analytics Engine",
    description:
      "Monitors holder distribution, fee flows, price action, and generates health reports. Powers the Tend dashboard.",
    defaultBps: 500,
    minBps: 200,
    maxBps: 1500,
    category: "analytics",
    status: "available",
  },
  {
    id: "growth-agent",
    name: "Growth Agent",
    description:
      "AI-powered community engagement and marketing. Generates market insights, tracks sentiment, and suggests strategies.",
    defaultBps: 2000,
    minBps: 500,
    maxBps: 4000,
    category: "growth",
    status: "available",
  },
  {
    id: "market-maker",
    name: "Market Maker",
    description:
      "Provides liquidity and maintains tight spreads. Reduces slippage for traders and improves token health.",
    defaultBps: 2500,
    minBps: 1000,
    maxBps: 5000,
    category: "market-making",
    status: "coming-soon",
  },
  {
    id: "community-rewards",
    name: "Community Rewards",
    description:
      "Distributes fee revenue to top holders and active community members. Incentivizes holding and engagement.",
    defaultBps: 1500,
    minBps: 500,
    maxBps: 3000,
    category: "community",
    status: "coming-soon",
  },
];

export function getService(id: string): ServiceDefinition | undefined {
  return SERVICE_REGISTRY.find((s) => s.id === id);
}

export function getAvailableServices(): ServiceDefinition[] {
  return SERVICE_REGISTRY.filter((s) => s.status === "available");
}
