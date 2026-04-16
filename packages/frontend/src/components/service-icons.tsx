import {
  ArrowDownUp,
  BarChart3,
  Zap,
  Settings,
  Coins,
  PieChart,
} from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { ComponentType } from "react";

const ICON_MAP: Record<string, ComponentType<LucideProps>> = {
  "buyback-bot": ArrowDownUp,
  analytics: BarChart3,
  "allocation-advisor": PieChart,
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

export { Zap, Coins, ArrowDownUp, BarChart3 };
