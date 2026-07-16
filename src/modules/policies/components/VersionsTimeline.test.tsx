import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type { PolicyDocument, PolicyVersionSummary } from "@/lib/pdp/contracts";
import { server } from "@/test/msw/server";
import { render, screen } from "@/test/render";
import { VersionsTimeline } from "./VersionsTimeline";

const audit = {
  createdBy: "admin",
  createdAt: "2026-07-15T22:51:00Z",
  changeReason: null,
};

const VERSIONS: PolicyVersionSummary[] = [
  { policyId: "stepper-create", version: 1, app: "nami", resourceType: "stepper", audit },
  { policyId: "stepper-create", version: 2, app: "nami", resourceType: "stepper", audit },
];

describe("VersionsTimeline", () => {
  it("fetches and shows an INACTIVE version's document on demand", async () => {
    let requestedVersion: string | null = null;
    server.use(
      http.get(
        "/api/pdp/apps/nami/policies/stepper-create/versions/:version",
        ({ params }) => {
          requestedVersion = params.version as string;
          // The version endpoint returns the policy document directly (flat).
          return HttpResponse.json<PolicyDocument>({
            policyId: "stepper-create",
            version: 2,
            resourceType: "stepper",
            actions: ["create"],
            combiningAlgorithm: "DENY_OVERRIDES",
            defaultEffect: "DENY",
            rules: [{ id: "admin-only", effect: "PERMIT" }],
          });
        },
      ),
    );
    const user = userEvent.setup();
    // activeVersion = 1, so v2 is inactive — must still be viewable.
    render(
      <VersionsTimeline
        app="nami"
        policyId="stepper-create"
        versions={VERSIONS}
        activeVersion={1}
      />,
    );

    // Newest first → the first "Ver documento" is v2 (the inactive one).
    const toggles = screen.getAllByText("Ver documento");
    await user.click(toggles[0]);

    expect(await screen.findByText(/admin-only/)).toBeInTheDocument();
    expect(requestedVersion).toBe("2");
  });

  it("does not fetch any version until it is expanded", () => {
    let called = false;
    server.use(
      http.get("/api/pdp/apps/nami/policies/stepper-create/versions/:version", () => {
        called = true;
        return HttpResponse.json({}, { status: 200 });
      }),
    );
    render(
      <VersionsTimeline
        app="nami"
        policyId="stepper-create"
        versions={VERSIONS}
        activeVersion={1}
      />,
    );

    expect(called).toBe(false);
  });
});
