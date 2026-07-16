import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type { Decision } from "@/lib/pdp/contracts";
import { server } from "@/test/msw/server";
import { render, screen } from "@/test/render";
import { PolicyTesterScreen } from "./PolicyTesterScreen";

const PERMIT: Decision = {
  allowed: true,
  reason: "assigned-access matched",
  decisionId: "uuid-1",
  policyVersion: "2",
  obligations: [],
};

describe("PolicyTesterScreen", () => {
  it("evaluates against the active policy and renders the Decision", async () => {
    let sentAttributes: unknown = null;
    server.use(
      http.post("/api/pdp/apps/records/evaluate", async ({ request }) => {
        const body = (await request.json()) as { resource: { attributes: unknown } };
        sentAttributes = body.resource.attributes;
        return HttpResponse.json<Decision>(PERMIT);
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

  it("simulates a pasted draft via :simulate (dry-run, R027)", async () => {
    // Holder (not a bare `let`): the assignment happens inside the MSW closure,
    // which TS control-flow would otherwise narrow away to null.
    const captured: {
      body: { policy: { policyId: string }; request: { action: string } } | null;
    } = { body: null };
    // `:` is a path-param delimiter in path-to-regexp — match with a RegExp.
    server.use(
      http.post(/\/api\/pdp\/apps\/records\/policies:simulate$/, async ({ request }) => {
        captured.body = (await request.json()) as {
          policy: { policyId: string };
          request: { action: string };
        };
        return HttpResponse.json<Decision>(PERMIT);
      }),
    );
    const user = userEvent.setup();
    render(<PolicyTesterScreen app="records" />);

    // Switch source to "draft" — the skeleton document is prefilled and valid.
    await user.selectOptions(screen.getByRole("combobox"), "draft");
    await user.click(screen.getByText("Evaluar"));

    expect(await screen.findByText("PERMIT")).toBeInTheDocument();
    expect(captured.body).not.toBeNull();
    expect(captured.body?.policy.policyId).toBe("draft");
    expect(captured.body?.request.action).toBe("document:read");
  });

  it("rejects an action without the resource:verb shape before calling the PDP", async () => {
    let called = false;
    server.use(
      http.post("/api/pdp/apps/records/evaluate", () => {
        called = true;
        return HttpResponse.json<Decision>(PERMIT);
      }),
    );
    const user = userEvent.setup();
    render(<PolicyTesterScreen app="records" />);

    const actionInput = screen.getByDisplayValue("document:read");
    fireEvent.change(actionInput, { target: { value: "stepper-create" } });
    await user.click(screen.getByText("Evaluar"));

    expect(await screen.findByText(/con dos puntos/)).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it("rejects a bare rules array before calling :simulate", async () => {
    let called = false;
    server.use(
      http.post(/\/api\/pdp\/apps\/records\/policies:simulate$/, () => {
        called = true;
        return HttpResponse.json<Decision>(PERMIT);
      }),
    );
    const user = userEvent.setup();
    render(<PolicyTesterScreen app="records" />);

    await user.selectOptions(screen.getByRole("combobox"), "draft");
    const draft = screen.getByDisplayValue(/policyId/) as HTMLTextAreaElement;
    // Valid JSON but an array, not a policy document. fireEvent.change avoids
    // userEvent's keyboard parser (both "{" and "[" are special keys there).
    fireEvent.change(draft, { target: { value: '[{ "id": "r", "effect": "PERMIT" }]' } });
    await user.click(screen.getByText("Evaluar"));

    expect(await screen.findByText(/arreglo de reglas/)).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it("surfaces INVALID_POLICY invalidParams from a draft simulation", async () => {
    server.use(
      http.post(/\/api\/pdp\/apps\/records\/policies:simulate$/, () =>
        HttpResponse.json(
          {
            title: "Invalid policy",
            status: 400,
            code: "INVALID_POLICY",
            detail: "The policy document was rejected.",
            invalidParams: [
              { field: "rules[0].condition.op", reason: "unknown operator" },
            ],
          },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<PolicyTesterScreen app="records" />);

    await user.selectOptions(screen.getByRole("combobox"), "draft");
    await user.click(screen.getByText("Evaluar"));

    expect(await screen.findByText(/rejected/)).toBeInTheDocument();
    expect(screen.getByText(/unknown operator/)).toBeInTheDocument();
    expect(screen.getByText("rules[0].condition.op")).toBeInTheDocument();
  });
});
