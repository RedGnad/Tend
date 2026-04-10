import {
  ArrowDownUp,
  Repeat,
  BarChart3,
  TrendingUp,
  LineChart,
  Gift,
  Zap,
  Settings,
  Coins,
  SlidersHorizontal,
} from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { ComponentType } from "react";

const ICON_MAP: Record<string, ComponentType<LucideProps>> = {
  "buyback-bot": ArrowDownUp,
  "fee-compounder": Repeat,
  analytics: BarChart3,
  "growth-agent": TrendingUp,
  "market-maker": LineChart,
  "community-rewards": Gift,
  "allocation-advisor": SlidersHorizontal,
};

export function ServiceIcon({
  serviceId,
  size = 18,
  className,
  ...props
}: { serviceId: string; size?: number; className?: string } & Omit<LucideProps, "size">) {
  const Icon = ICON_MAP[serviceId] ?? Settings;
  return <Icon size={size} className={className} strokeWidth={1.8} {...props} />;
}

export { Zap, Coins, ArrowDownUp, Repeat, BarChart3, TrendingUp, LineChart, Gift };
