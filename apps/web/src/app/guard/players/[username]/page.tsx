import { GuardPlayerClient } from "@/components/guard/GuardPlayerClient";

export default async function GuardPlayerPage({
  params
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  return <GuardPlayerClient username={decodeURIComponent(username)} />;
}
