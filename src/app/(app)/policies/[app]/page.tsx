import { AppPoliciesScreen } from "@/modules/policies/AppPoliciesScreen";

export default async function AppPoliciesPage({
  params,
}: {
  params: Promise<{ app: string }>;
}) {
  const { app } = await params;
  return <AppPoliciesScreen app={app} />;
}
