import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type { PolicyDocument, PolicyHeadView } from "@/lib/pdp/contracts";
import { server } from "@/test/msw/server";
import { render, screen, waitFor } from "@/test/render";
import { EditPolicyScreen } from "./EditPolicyScreen";

const HEAD: PolicyHeadView = {
  policyId: "doc-access",
  app: "records",
  resourceType: "document",
  activeVersion: 1,
  revision: 4,
  audit: { createdBy: "someone", createdAt: "2026-07-10T12:00:00Z", changeReason: null },
  activeContent: null,
};
// The single-version endpoint returns the policy document directly (flat).
const V1: PolicyDocument = {
  policyId: "doc-access",
  version: 1,
  resourceType: "document",
  actions: ["read"],
  combiningAlgorithm: "DENY_OVERRIDES",
  defaultEffect: "DENY",
  rules: [
    {
      id: "r1",
      effect: "PERMIT",
      condition: {
        type: "comparison",
        op: "IN",
        left: { ref: "subject.id" },
        right: { ref: "resource.attr.assignees" },
      },
    },
  ],
};

function seed(putHandler: Parameters<typeof http.put>[1]) {
  server.use(
    http.get("/api/pdp/apps/records/policies/doc-access", () => HttpResponse.json(HEAD)),
    http.get("/api/pdp/apps/records/policies/doc-access/versions", () =>
      HttpResponse.json({
        data: [V1],
        pagination: { page: 1, size: 50, totalPages: 1, totalElements: 1 },
      }),
    ),
    http.get("/api/pdp/apps/records/policies/doc-access/versions/1", () =>
      HttpResponse.json(V1),
    ),
    http.put("/api/pdp/apps/records/policies/doc-access", putHandler),
  );
}

describe("EditPolicyScreen — append new version (PUT)", () => {
  it("prefills from the latest version and appends v2 with If-Match", async () => {
    let received: { ifMatch: string | null; version: number } | null = null;
    seed(async ({ request }) => {
      const body = (await request.json()) as { content: { version: number } };
      received = {
        ifMatch: request.headers.get("if-match"),
        version: body.content.version,
      };
      return HttpResponse.json({ ...HEAD, revision: 5 });
    });

    const user = userEvent.setup();
    render(<EditPolicyScreen app="records" policyId="doc-access" />);

    // Prefilled: actions field shows the v1 value.
    expect(await screen.findByDisplayValue("read")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/area-scope/), "add area rule");
    await user.click(screen.getByText(/Guardar como v2/));

    await waitFor(() => expect(received).not.toBeNull());
    // Next version number and the head revision as ETag.
    expect(received!.version).toBe(2);
    expect(received!.ifMatch).toBe('"4"');
  });
});
