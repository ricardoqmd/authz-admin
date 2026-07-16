import { PolicyTesterScreen } from "@/modules/policies/PolicyTesterScreen";

export default async function PolicyTesterPage({
  params,
}: {
  params: Promise<{ app: string; policyId: string }>;
}) {
  const { app, policyId } = await params;
  return <PolicyTesterScreen app={app} policyId={policyId} />;
}
