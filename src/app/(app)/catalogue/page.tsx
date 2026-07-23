import { Suspense } from "react";
import { CatalogueScreen } from "@/modules/catalogue/CatalogueScreen";

export default function CataloguePage() {
  return (
    <Suspense>
      <CatalogueScreen />
    </Suspense>
  );
}
