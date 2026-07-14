import { PolicyDetailScreen } from "@/modules/policies/PolicyDetailScreen";

export default async function PolicyDetailPage({
  params,
}: {
  params: Promise<{ app: string; policyId: string }>;
}) {
  const { app, policyId } = await params;
  return <PolicyDetailScreen app={app} policyId={policyId} />;
}
