import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type { PolicyHeadView, PolicyVersionSummary } from "@/lib/pdp/contracts";
import { server } from "@/test/msw/server";
import { render, screen, waitFor } from "@/test/render";
import { LifecycleActions } from "./LifecycleActions";

const HEAD: PolicyHeadView = {
  policyId: "doc-access",
  app: "records",
  resourceType: "document",
  activeVersion: null,
  revision: 3,
  audit: { createdBy: "someone", createdAt: "2026-07-10T12:00:00Z", changeReason: null },
  activeContent: null,
};
const VERSIONS: PolicyVersionSummary[] = [
  {
    policyId: "doc-access",
    app: "records",
    version: 1,
    resourceType: "document",
    audit: {
      createdBy: "someone",
      createdAt: "2026-07-10T12:00:00Z",
      changeReason: null,
    },
  },
  {
    policyId: "doc-access",
    app: "records",
    version: 2,
    resourceType: "document",
    audit: {
      createdBy: "someone",
      createdAt: "2026-07-10T12:00:00Z",
      changeReason: null,
    },
  },
];

describe("LifecycleActions — optimistic concurrency (412)", () => {
  it("sends If-Match with the head revision and reports a 412 with reload-and-retry", async () => {
    let receivedIfMatch: string | null = null;
    server.use(
      http.post("/api/pdp/apps/records/policies/doc-access/activate", ({ request }) => {
        receivedIfMatch = request.headers.get("if-match");
        // Simulate another admin having moved the head: stale precondition.
        return HttpResponse.json(
          { title: "Precondition failed", status: 412, code: "PRECONDITION_FAILED" },
          { status: 412 },
        );
      }),
    );

    const user = userEvent.setup();
    render(<LifecycleActions head={HEAD} versions={VERSIONS} onReload={() => {}} />);

    await user.click(screen.getByText("Activar"));
    await user.click(screen.getByText(/Poner v2 en producción/));

    // The head revision (3) travelled as the ETag.
    await waitFor(() => expect(receivedIfMatch).toBe('"3"'));
    // The stale banner and the reload affordance appear; input is not lost.
    expect(
      await screen.findByText(/Otro admin cambió esta política/),
    ).toBeInTheDocument();
    expect(screen.getByText("Recargar")).toBeInTheDocument();
  });
});
