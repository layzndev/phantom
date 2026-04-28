import { GuardIpClient } from "@/components/guard/GuardIpClient";

export default async function GuardIpPage({
  params
}: {
  params: Promise<{ ip: string }>;
}) {
  const { ip } = await params;
  return <GuardIpClient ip={decodeURIComponent(ip)} />;
}
