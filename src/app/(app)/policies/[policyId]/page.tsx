import { PolicyDetailScreen } from "@/modules/policies/PolicyDetailScreen";

export default async function PolicyDetailPage({
  params,
}: {
  params: Promise<{ policyId: string }>;
}) {
  const { policyId } = await params;
  return <PolicyDetailScreen policyId={policyId} />;
}
