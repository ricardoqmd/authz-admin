import { EditPolicyScreen } from "@/modules/policies/EditPolicyScreen";

export default async function EditPolicyPage({
  params,
}: {
  params: Promise<{ app: string; policyId: string }>;
}) {
  const { app, policyId } = await params;
  return <EditPolicyScreen app={app} policyId={policyId} />;
}
