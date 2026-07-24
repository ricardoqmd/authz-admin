import { Suspense } from "react";
import { ConfigScreen } from "@/modules/config/ConfigScreen";

export default function ConfigPage() {
  return (
    <Suspense>
      <ConfigScreen />
    </Suspense>
  );
}
