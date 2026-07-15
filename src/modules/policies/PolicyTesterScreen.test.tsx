import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type { Decision } from "@/lib/pdp/contracts";
import { server } from "@/test/msw/server";
import { render, screen } from "@/test/render";
import { PolicyTesterScreen } from "./PolicyTesterScreen";

describe("PolicyTesterScreen", () => {
  it("evaluates against the active policy and renders the Decision", async () => {
    let sentAttributes: unknown = null;
    server.use(
      http.post("/api/pdp/apps/records/evaluate", async ({ request }) => {
        const body = (await request.json()) as { resource: { attributes: unknown } };
        sentAttributes = body.resource.attributes;
        return HttpResponse.json<Decision>({
          allowed: true,
          reason: "assigned-access matched",
          decisionId: "uuid-1",
          policyVersion: "2",
          obligations: [],
        });
      }),
    );
    const user = userEvent.setup();
    render(<PolicyTesterScreen app="records" />);

    await user.click(screen.getByText("Evaluar"));

    expect(await screen.findByText("PERMIT")).toBeInTheDocument();
    expect(screen.getByText(/assigned-access matched/)).toBeInTheDocument();
    expect(screen.getByText(/política v2/)).toBeInTheDocument();
    expect(sentAttributes).toEqual({ assignees: ["test-user"] });
  });

  it("blocks on invalid JSON before calling the PDP", async () => {
    let called = false;
    server.use(
      http.post("/api/pdp/apps/records/evaluate", () => {
        called = true;
        return HttpResponse.json({ allowed: false }, { status: 200 });
      }),
    );
    const user = userEvent.setup();
    render(<PolicyTesterScreen app="records" />);

    const attrs = screen.getByDisplayValue(/assignees/) as HTMLTextAreaElement;
    await user.clear(attrs);
    await user.type(attrs, "not json");
    await user.click(screen.getByText("Evaluar"));

    expect(await screen.findByText(/JSON inválido/)).toBeInTheDocument();
    expect(called).toBe(false);
  });
});
