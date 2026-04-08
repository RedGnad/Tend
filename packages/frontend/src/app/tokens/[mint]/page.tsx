import { TokenDetail } from "./token-detail";

export const dynamic = "force-dynamic";

export default async function TokenPage({
  params,
}: {
  params: Promise<{ mint: string }>;
}) {
  const { mint } = await params;
  return <TokenDetail mint={mint} />;
}
