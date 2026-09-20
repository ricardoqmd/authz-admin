import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { Decision } from "@/lib/pdp/contracts";
import { useSession } from "@/modules/access/api/session.queries";
import { engineRefusal } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { render, screen } from "@/test/render";
import { checkAction, PolicyTesterScreen } from "./PolicyTesterScreen";

const PERMIT: Decision = {
  allowed: true,
  reason: "assigned-access matched",
  decisionId: "uuid-1",
  policyVersion: "2",
  obligations: [],
};

const DELEGATED_REFUSAL =
  "Rechazado. Esta petición nombra a otro sujeto, y actuar en nombre de otra persona requiere el marcador de delegación en tu token. Deja el sujeto vacío para probar como tú mismo.";

/** A 403 whose body talks about delegation, as the engine's own delegation refusal does. */
function delegationBody() {
  return HttpResponse.json(
    {
      type: "about:blank",
      code: "DELEGATION_MARKER_REQUIRED",
      title: "Forbidden",
      status: 403,
      detail: "delegation marker required to query a different subject",
    },
    { status: 403, headers: { "content-type": "application/problem+json" } },
  );
}

/** Mounted beside the screen: it shares the screen's query client, so it shows when the session has answered. */
function SessionSettled() {
  return useSession().isPending ? null : <span data-testid="session-settled" />;
}

/**
 * Render the tester once /api/session has answered, as for a person who has
 * waited for the page: whether a refusal is put down to delegation depends on
 * the caller's own subject.
 */
async function renderSettled(ui: ReactElement) {
  render(
    <>
      {ui}
      <SessionSettled />
    </>,
  );
  await screen.findByTestId("session-settled");
}

const audit = {
  createdBy: "admin",
  createdAt: "2026-07-16T10:00:00Z",
  changeReason: null,
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

  it("prefills the draft from a scoped policy's version and simulates that document", async () => {
    const doc = {
      policyId: "stepper-create",
      version: 1,
      resourceType: "stepper",
      actions: ["create"],
      combiningAlgorithm: "DENY_OVERRIDES",
      defaultEffect: "DENY",
      rules: [{ id: "admin-can-create", effect: "PERMIT" }],
    };
    const captured: { policyId: string | null } = { policyId: null };
    server.use(
      http.get("/api/pdp/apps/records/policies/stepper-create", () =>
        HttpResponse.json({
          policyId: "stepper-create",
          app: "records",
          resourceType: "stepper",
          activeVersion: 1,
          revision: 1,
          audit,
        }),
      ),
      http.get("/api/pdp/apps/records/policies/stepper-create/versions", () =>
        HttpResponse.json({
          data: [
            {
              policyId: "stepper-create",
              version: 1,
              app: "records",
              resourceType: "stepper",
              audit,
            },
          ],
          pagination: { page: 1, size: 50, totalPages: 1, totalElements: 1 },
        }),
      ),
      http.get("/api/pdp/apps/records/policies/stepper-create/versions/1", () =>
        HttpResponse.json(doc),
      ),
      http.post(/\/api\/pdp\/apps\/records\/policies:simulate$/, async ({ request }) => {
        const body = (await request.json()) as { policy: { policyId: string } };
        captured.policyId = body.policy.policyId;
        return HttpResponse.json<Decision>(PERMIT);
      }),
    );
    const user = userEvent.setup();
    render(<PolicyTesterScreen app="records" policyId="stepper-create" />);

    // The draft textarea is prefilled with the version document.
    expect(await screen.findByDisplayValue(/admin-can-create/)).toBeInTheDocument();
    await user.click(screen.getByText("Evaluar"));

    expect(await screen.findByText("PERMIT")).toBeInTheDocument();
    expect(captured.policyId).toBe("stepper-create");
  });

  it("rejects a malformed action before calling the PDP", async () => {
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
    fireEvent.change(actionInput, { target: { value: "document read" } });
    await user.click(screen.getByText("Evaluar"));

    expect(await screen.findByText(/sin espacios/)).toBeInTheDocument();
    expect(called).toBe(false);
  });

  /*
   * ADR-036: an action whose prefix is not the resource type is a question
   * about the wrong thing. The screen refuses to compose it.
   */
  it("rejects an action whose prefix is not the resource type", async () => {
    let called = false;
    server.use(
      http.post("/api/pdp/apps/records/evaluate", () => {
        called = true;
        return HttpResponse.json<Decision>(PERMIT);
      }),
    );
    const user = userEvent.setup();
    render(<PolicyTesterScreen app="records" />);

    // Resource type stays "document"; the action names another type.
    fireEvent.change(screen.getByDisplayValue("document:read"), {
      target: { value: "report:read" },
    });
    await user.click(screen.getByText("Evaluar"));

    expect(
      await screen.findByText(
        /prefijo de la acción \(report\) debe ser el tipo de recurso \(document\)/,
      ),
    ).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it("sends a bare verb as it is: no prefix cannot disagree", async () => {
    const captured: { action: string | null } = { action: null };
    server.use(
      http.post("/api/pdp/apps/records/evaluate", async ({ request }) => {
        captured.action = ((await request.json()) as { action: string }).action;
        return HttpResponse.json<Decision>(PERMIT);
      }),
    );
    const user = userEvent.setup();
    render(<PolicyTesterScreen app="records" />);

    fireEvent.change(screen.getByDisplayValue("document:read"), {
      target: { value: "read" },
    });
    await user.click(screen.getByText("Evaluar"));

    expect(await screen.findByText("PERMIT")).toBeInTheDocument();
    expect(captured.action).toBe("read");
  });

  it("sends a prefixed action whose prefix is the resource type", async () => {
    const captured: { body: { action: string; resource: { type: string } } | null } = {
      body: null,
    };
    server.use(
      http.post("/api/pdp/apps/records/evaluate", async ({ request }) => {
        captured.body = (await request.json()) as {
          action: string;
          resource: { type: string };
        };
        return HttpResponse.json<Decision>(PERMIT);
      }),
    );
    const user = userEvent.setup();
    render(<PolicyTesterScreen app="records" />);

    await user.click(screen.getByText("Evaluar"));

    expect(await screen.findByText("PERMIT")).toBeInTheDocument();
    expect(captured.body?.action).toBe("document:read");
    expect(captured.body?.resource.type).toBe("document");
  });

  it("renders the engine's 400 like any other validation failure, whatever its code", async () => {
    // The code is deliberately one this console has never heard of: ADR-036's
    // own code is being introduced in parallel, and nothing here may depend on it.
    server.use(
      http.post("/api/pdp/apps/records/evaluate", () =>
        HttpResponse.json(
          {
            type: "about:blank",
            code: "SOME_FUTURE_CODE",
            title: "Bad request",
            status: 400,
            detail: "action prefix 'x' does not match resource type 'y'.",
          },
          { status: 400, headers: { "content-type": "application/problem+json" } },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<PolicyTesterScreen app="records" />);

    await user.click(screen.getByText("Evaluar"));

    expect(
      await screen.findByText("action prefix 'x' does not match resource type 'y'."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No puedes administrar esta aplicación."),
    ).not.toBeInTheDocument();
  });

  it("renders the engine's 403 as the one refusal sentence", async () => {
    server.use(http.post("/api/pdp/apps/records/evaluate", () => engineRefusal()));
    const user = userEvent.setup();
    render(<PolicyTesterScreen app="records" />);

    await user.click(screen.getByText("Evaluar"));

    expect(
      await screen.findByText("No puedes administrar esta aplicación."),
    ).toBeInTheDocument();
    // No subject was sent, so nothing is said about delegation.
    expect(screen.queryByText(DELEGATED_REFUSAL)).not.toBeInTheDocument();
  });

  /*
   * A refused request that named a subject. The screen knows why this one is
   * different — it filled that field — so it says so without reading the body:
   * the literal refusal and a 403 whose body says anything else render the same.
   */
  it.each([
    ["the engine's literal refusal", () => engineRefusal()],
    [
      "a 403 whose body says something else",
      () =>
        HttpResponse.json(
          {
            type: "about:blank",
            code: "DELEGATION_MARKER_REQUIRED",
            title: "Forbidden",
            status: 403,
            detail: "delegation marker required to evaluate for another subject",
            invalidParams: [{ field: "subject", reason: "not permitted" }],
          },
          { status: 403, headers: { "content-type": "application/problem+json" } },
        ),
    ],
  ])("says a refused delegated request needs the delegation marker — %s", async (_, answer) => {
    let sent: unknown = null;
    server.use(
      http.post("/api/pdp/apps/records/evaluate", async ({ request }) => {
        sent = await request.json();
        return answer();
      }),
    );
    const user = userEvent.setup();
    await renderSettled(<PolicyTesterScreen app="records" />);

    fireEvent.change(screen.getByLabelText("Sujeto (delegado)"), {
      target: { value: "user-x" },
    });
    await user.click(screen.getByText("Evaluar"));

    const note = await screen.findByText(DELEGATED_REFUSAL);
    expect(sent).toMatchObject({ subject: "user-x" });
    // The sentence and nothing else: no field list, nothing from the body.
    expect(note.parentElement?.textContent).toBe(DELEGATED_REFUSAL);
    expect(
      screen.queryByText("No puedes administrar esta aplicación."),
    ).not.toBeInTheDocument();
  });

  /*
   * The other direction: the screen knows it LOCALLY, so a body that talks about
   * delegation changes nothing when this request named no one.
   */
  it("gives a refusal whose body mentions delegation the generic sentence when no subject was sent", async () => {
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.post("/api/pdp/apps/records/evaluate", async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return delegationBody();
      }),
    );
    const user = userEvent.setup();
    await renderSettled(<PolicyTesterScreen app="records" />);

    await user.click(screen.getByText("Evaluar"));

    const note = await screen.findByText("No puedes administrar esta aplicación.");
    expect(sent).not.toHaveProperty("subject");
    expect(note.parentElement?.textContent).toBe(
      "No puedes administrar esta aplicación.",
    );
    expect(screen.queryByText(DELEGATED_REFUSAL)).not.toBeInTheDocument();
  });

  /*
   * The delegated sentence names a cause, so it appears only where the screen can
   * be right about it, and "right" is the engine's own comparison: a non-blank
   * `sub` is the caller verbatim, compared with the requested subject by `equals`
   * (service-policy AuthContext.callerSubject and resolveEffectiveSubject,
   * v0.6.1). Each row fills the field, is refused, and must get the sentence that
   * comparison implies — generic where the screen cannot be right, delegated
   * where the engine does ask for the marker.
   */
  it.each([
    {
      name: "simulate: the engine's control-plane gate runs before the subject",
      subject: "user-x",
      draft: true,
      session: () => HttpResponse.json({ sub: "mock-admin", apps: ["records"] }),
      delegated: false,
    },
    {
      name: "the field carries the caller's own subject: no marker is asked",
      subject: "mock-admin",
      draft: false,
      session: () => HttpResponse.json({ sub: "mock-admin", apps: ["records"] }),
      delegated: false,
    },
    {
      name: "the caller's own subject is not known",
      subject: "user-x",
      draft: false,
      session: () =>
        HttpResponse.json({ title: "Unavailable", status: 503 }, { status: 503 }),
      delegated: false,
    },
    {
      // A `sub` of only spaces passes the BFF, which asks for a non-empty
      // string, but the engine falls back to `preferred_username` when the
      // subject is blank: the two do not name the same caller, so the screen
      // does not know its own subject and must not name a cause.
      name: "the caller's own subject is blank, so it is not known either",
      subject: "mock-admin",
      draft: false,
      session: () => HttpResponse.json({ sub: "   ", apps: ["records"] }),
      delegated: false,
    },
    {
      // The other direction of the same rule, and the one that pins how the
      // blank is recognised. A `sub` with spaces around it is NOT blank, so the
      // engine keeps it verbatim and `equals` says `  mock-admin  ` is not
      // `mock-admin`: the marker IS asked for, and the screen must say so. A
      // screen that trimmed the identity rather than only testing it for blank
      // would fall silent here, and only this row would notice.
      name: "the own subject carries spaces: known, and not the field",
      subject: "mock-admin",
      draft: false,
      session: () => HttpResponse.json({ sub: "  mock-admin  ", apps: ["records"] }),
      delegated: true,
    },
  ])("the refusal gets the sentence the engine's comparison implies — $name", async (row) => {
    let sent: Record<string, unknown> | null = null;
    const refuse = async ({ request }: { request: Request }) => {
      sent = (await request.json()) as Record<string, unknown>;
      return delegationBody();
    };
    server.use(
      http.get("/api/session", row.session),
      http.post("/api/pdp/apps/records/evaluate", refuse),
      http.post("/api/pdp/apps/records/policies:simulate", refuse),
    );
    const user = userEvent.setup();
    await renderSettled(<PolicyTesterScreen app="records" />);

    if (row.draft) {
      fireEvent.change(screen.getByLabelText("Fuente"), { target: { value: "draft" } });
    }
    fireEvent.change(screen.getByLabelText("Sujeto (delegado)"), {
      target: { value: row.subject },
    });
    await user.click(screen.getByText("Evaluar"));

    const expected = row.delegated
      ? DELEGATED_REFUSAL
      : "No puedes administrar esta aplicación.";
    const other = row.delegated
      ? "No puedes administrar esta aplicación."
      : DELEGATED_REFUSAL;
    const note = await screen.findByText(expected);
    const request = row.draft
      ? (sent as { request?: Record<string, unknown> } | null)?.request
      : sent;
    expect(request).toMatchObject({ subject: row.subject });
    // The sentence and nothing else: no field list, nothing from the body.
    expect(note.parentElement?.textContent).toBe(expected);
    expect(screen.queryByText(other)).not.toBeInTheDocument();
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

describe("checkAction", () => {
  it.each([
    ["read", "document"],
    ["document:read", "document"],
    ["bulk-export", "report"],
  ])("accepts %s for resource type %s", (action, type) => {
    expect(checkAction(action, type)).toEqual({ ok: true });
  });

  it.each([
    ["report:read", "document", "report"],
    // Literal comparison, as in the engine: no case folding.
    ["Document:read", "document", "Document"],
  ])("refuses %s for resource type %s", (action, type, prefix) => {
    expect(checkAction(action, type)).toEqual({ ok: false, reason: "prefix", prefix });
  });

  it.each([
    "",
    "document:",
    ":read",
    "document read",
    "a:b:c",
  ])("refuses the malformed %j", (action) => {
    expect(checkAction(action, "document")).toEqual({ ok: false, reason: "shape" });
  });
});
