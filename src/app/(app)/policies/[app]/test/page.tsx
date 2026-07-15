import { PolicyTesterScreen } from "@/modules/policies/PolicyTesterScreen";

export default async function PolicyTesterPage({
  params,
}: {
  params: Promise<{ app: string }>;
}) {
  const { app } = await params;
  return <PolicyTesterScreen app={app} />;
}
