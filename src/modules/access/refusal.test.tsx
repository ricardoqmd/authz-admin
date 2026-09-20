/*
 * THE REFUSAL TEST (pap-003 Task 5; instrument rebuilt in pap-003b, extended in
 * pap-003c).
 *
 * The engine answers "an application you do not hold" and "an application that
 * does not exist" with the same bytes (service-policy ADR-033 §2). A console that
 * rendered the two differently would hand back what the engine refused to
 * disclose. There are two realistic ways it could, and this file measures both:
 *
 *   1. Reading the BODY of the 403. Same application, answered once by the
 *      engine's literal refusal and once by a "leaking" 403 — another code, a
 *      detail, fields naming the application. The two renders must be
 *      IDENTICAL, with no normalisation beyond React's generated ids.
 *   2. Consulting the SESSION. The browser holds "which applications you hold"
 *      twice: /api/session, and the applications the auth adapter decodes and
 *      the auth port exposes (`useAuth().user.apps`). Same application, once
 *      with both truthful and once with each — and both — listing it. The
 *      renders must be identical apart from the application selector and the
 *      datalists — the only places the session is allowed to reach.
 *
 * Plus the comparison across applications (not held vs nonexistent, same
 * body), which needs one substitution: the application name the caller typed.
 *
 * Sources this file does not vary — the query cache, browser storage, the live
 * merged listing the engine answers — cannot break the comparison even so, and
 * not for want of an instrument: an application the caller does not hold and one
 * that does not exist are absent from every "what you hold" list alike. Only a
 * source of what EXISTS could tell the two apart, and this console has none; the
 * engine answers both with the same bytes. Inventing one would be the console
 * deciding again, which is the other property.
 *
 * WHICH SURFACES. Not a list kept from memory: the last test reads, out of every
 * source file the browser can run, each request the code makes — every
 * apiGet/apiPost/apiPut/apiDelete call and every fetch — and fails unless each
 * was refused on some surface below, or is named in NOT_ENGINE with the reason
 * it cannot be. It reads source text; it is not a compiler. What that reading
 * reaches is written where it is done, above browserRequests().
 * What no reading of the calls can see — a request refused on one screen but not
 * on another that also makes it — is in reports/pap-003c.report.md.
 *
 * Adopted from the audit-pap-003 probe (render.probe.test.tsx); what changed is
 * in reports/pap-003b.report.md and reports/pap-003c.report.md.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PolicyDocument,
  PolicyHeadView,
  PolicyVersionSummary,
} from "@/lib/pdp/contracts";
import { CatalogueActionsField } from "@/modules/catalogue/CatalogueActionsField";
import { CatalogueScreen } from "@/modules/catalogue/CatalogueScreen";
import { ConfigScreen } from "@/modules/config/ConfigScreen";
import { AppPoliciesScreen } from "@/modules/policies/AppPoliciesScreen";
import { CreatePolicyScreen } from "@/modules/policies/CreatePolicyScreen";
import { LifecycleActions } from "@/modules/policies/components/LifecycleActions";
import { EditPolicyScreen } from "@/modules/policies/EditPolicyScreen";
import { PoliciesScreen } from "@/modules/policies/PoliciesScreen";
import { PolicyDetailScreen } from "@/modules/policies/PolicyDetailScreen";
import { PolicyTesterScreen } from "@/modules/policies/PolicyTesterScreen";
import { ENGINE_REFUSAL_BODY } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { render, screen } from "@/test/render";

/*
 * The second source of the session: the auth port. Every scenario sets the
 * applications the port's user carries, so no render depends on the mock
 * adapter's fixed demo list.
 */
const port = vi.hoisted(() => ({ apps: null as string[] | null }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...original,
    useAuth: () => {
      const auth = original.useAuth();
      return auth.user && port.apps
        ? { ...auth, user: { ...auth.user, apps: port.apps } }
        : auth;
    },
  };
});

/** Exists in the engine, but the caller's token does not carry it. */
const NOT_HELD = "archive";
/** Exists nowhere. */
const NONEXISTENT = "zz-nonce-7f3a";

const FORBIDDEN = "No puedes administrar esta aplicación.";

/** What the truthful session lists: neither application above. */
const SESSION = ["records", "billing"];

/*
 * 403s an engine that leaked would send. Each carries something that names or
 * describes the application; each code is one a screen branches on for another
 * status, so a screen that consulted the code before the status would take that
 * branch here.
 */
const LEAKS: { name: string; body: (app: string) => Record<string, unknown> }[] = [
  {
    name: "says the application does not exist",
    body: (app) => ({
      code: "APP_NOT_FOUND",
      detail: `application ${app} does not exist`,
      invalidParams: [{ field: "app", reason: `${app} is unknown` }],
    }),
  },
  {
    name: "INVALID_POLICY with fields",
    body: (app) => ({
      code: "INVALID_POLICY",
      detail: `${app} has no such resource type`,
      invalidParams: [{ field: "rules[0]", reason: `${app} is unknown` }],
    }),
  },
  {
    name: "POLICY_ALREADY_EXISTS",
    body: (app) => ({ code: "POLICY_ALREADY_EXISTS", detail: `${app} does not exist` }),
  },
  {
    name: "INVALID_APP_CONFIG with fields",
    body: (app) => ({
      code: "INVALID_APP_CONFIG",
      detail: `${app} does not exist`,
      invalidParams: [{ field: "subjectAttributes", reason: `${app} is unknown` }],
    }),
  },
  {
    name: "APP_CONFIG_ALREADY_EXISTS",
    body: (app) => ({
      code: "APP_CONFIG_ALREADY_EXISTS",
      detail: `${app} does not exist`,
    }),
  },
  {
    name: "ACTION_IN_USE with policy ids",
    body: (app) => ({
      code: "ACTION_IN_USE",
      detail: `${app} does not exist`,
      policyIds: [`${app}-is-unknown`],
    }),
  },
  {
    name: "CATALOGUE_ENTRY_ALREADY_EXISTS",
    body: (app) => ({
      code: "CATALOGUE_ENTRY_ALREADY_EXISTS",
      detail: `${app} does not exist`,
    }),
  },
  {
    name: "talks about delegation",
    body: (app) => ({
      code: "DELEGATION_MARKER_REQUIRED",
      detail: `delegation marker required: ${app} does not exist`,
    }),
  },
];

/** Nothing of any refusal body — the literal's or a leak's — may be rendered. */
const BODY_NEEDLES = [
  "not authorized",
  "FORBIDDEN",
  "403",
  "ERRORS.md",
  "does not exist",
  "is unknown",
  "no such",
  "delegation",
  ...LEAKS.map((leak) => leak.body("x").code as string),
];

function leakBody(leak: (typeof LEAKS)[number], app: string): string {
  return JSON.stringify({
    type: "about:blank#not-found",
    title: "Not Found",
    status: 403,
    ...leak.body(app),
  });
}

const refuse = (body: string) => () =>
  new HttpResponse(body, {
    status: 403,
    headers: { "content-type": "application/problem+json" },
  });

const audit = {
  createdBy: "someone",
  createdAt: "2026-07-10T12:00:00Z",
  changeReason: null,
};

function head(app: string): PolicyHeadView {
  return {
    policyId: "doc-access",
    app,
    resourceType: "document",
    activeVersion: null,
    revision: 3,
    audit,
    activeContent: null,
  };
}

function versions(app: string): PolicyVersionSummary[] {
  return [{ policyId: "doc-access", app, version: 1, resourceType: "document", audit }];
}

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

/**
 * A surface: a screen brought to the point where it has asked the engine and
 * rendered the refusal. Without a `target`, every request it makes is refused.
 * With one, the requests in `reads` succeed and only the target is refused —
 * the write, or the one read under test.
 */
type Surface = {
  name: string;
  ui: (app: string) => ReactElement;
  reads?: (app: string) => Parameters<typeof server.use>;
  target?: {
    method: "get" | "post" | "put" | "delete";
    path: (app: string) => string | RegExp;
  };
  act?: (app: string) => Promise<void>;
};

const DETAIL: Surface = {
  name: "read · policy detail",
  ui: (app) => <PolicyDetailScreen app={app} policyId="doc-access" />,
};

const SURFACES: Surface[] = [
  { name: "read · per-app list", ui: (app) => <AppPoliciesScreen app={app} /> },
  DETAIL,
  {
    name: "read · policy edit (load)",
    ui: (app) => <EditPolicyScreen app={app} policyId="doc-access" />,
  },
  {
    name: "read · policy edit (the version it prefills from)",
    ui: (app) => <EditPolicyScreen app={app} policyId="doc-access" />,
    reads: (app) => [
      http.get(`/api/pdp/apps/${app}/policies/doc-access`, () =>
        HttpResponse.json({ ...head(app), activeVersion: 1 }),
      ),
      http.get(`/api/pdp/apps/${app}/policies/doc-access/versions`, () =>
        HttpResponse.json({
          data: versions(app),
          pagination: { page: 1, size: 50, totalPages: 1, totalElements: 1 },
        }),
      ),
    ],
    target: {
      method: "get",
      path: (app) => `/api/pdp/apps/${app}/policies/doc-access/versions/1`,
    },
  },
  {
    name: "read · cross-application list",
    ui: () => <PoliciesScreen />,
  },
  {
    name: "read · catalogue",
    ui: () => <CatalogueScreen />,
    act: async (app) => {
      fireEvent.change(screen.getByLabelText("App"), { target: { value: app } });
    },
  },
  {
    name: "read · configuration",
    ui: () => <ConfigScreen />,
    act: async (app) => {
      fireEvent.change(screen.getByLabelText("App"), { target: { value: app } });
    },
  },
  {
    name: "read · catalogue actions field (create/edit)",
    ui: (app) => (
      <CatalogueActionsField
        app={app}
        resourceType="document"
        value="*"
        onChange={() => {}}
      />
    ),
  },
  {
    name: "write · tester evaluate (POST)",
    ui: (app) => <PolicyTesterScreen app={app} />,
    target: { method: "post", path: (app) => `/api/pdp/apps/${app}/evaluate` },
    act: async () => {
      await userEvent.setup().click(screen.getByText("Evaluar"));
    },
  },
  {
    name: "write · tester simulate (POST)",
    ui: (app) => <PolicyTesterScreen app={app} />,
    target: {
      method: "post",
      // A RegExp: in a path string, msw would read ":simulate" as a parameter.
      path: (app) => new RegExp(`/api/pdp/apps/${app}/policies:simulate$`),
    },
    act: async () => {
      fireEvent.change(screen.getByLabelText("Fuente"), { target: { value: "draft" } });
      await userEvent.setup().click(screen.getByText("Evaluar"));
    },
  },
  {
    name: "write · activate (POST)",
    ui: (app) => (
      <LifecycleActions head={head(app)} versions={versions(app)} onReload={() => {}} />
    ),
    target: {
      method: "post",
      path: (app) => `/api/pdp/apps/${app}/policies/doc-access/activate`,
    },
    act: async () => {
      const user = userEvent.setup();
      await user.click(screen.getByText("Activar"));
      await user.click(screen.getByText(/Poner v1 en producción/));
    },
  },
  {
    name: "write · deactivate (POST)",
    ui: (app) => (
      <LifecycleActions
        head={{ ...head(app), activeVersion: 1 }}
        versions={versions(app)}
        onReload={() => {}}
      />
    ),
    target: {
      method: "post",
      path: (app) => `/api/pdp/apps/${app}/policies/doc-access/deactivate`,
    },
    act: async () => {
      const user = userEvent.setup();
      await user.click(screen.getByText("Desactivar"));
      await user.click(screen.getByText("Retirar de producción"));
    },
  },
  {
    name: "write · policy create (POST)",
    ui: () => <CreatePolicyScreen />,
    reads: (app) => [
      http.get(`/api/pdp/apps/${app}/action-catalogue/document`, () =>
        HttpResponse.json({
          app,
          resourceType: "document",
          actions: ["read"],
          revision: 1,
        }),
      ),
    ],
    target: { method: "post", path: (app) => `/api/pdp/apps/${app}/policies` },
    act: async (app) => {
      fireEvent.change(screen.getByPlaceholderText("doc-access"), {
        target: { value: "doc-access" },
      });
      fireEvent.change(screen.getByPlaceholderText("records"), {
        target: { value: app },
      });
      fireEvent.change(screen.getByPlaceholderText("document"), {
        target: { value: "document" },
      });
      await userEvent.setup().click(screen.getByText("Crear (inactiva)"));
    },
  },
  {
    name: "write · policy edit (PUT append)",
    ui: (app) => <EditPolicyScreen app={app} policyId="doc-access" />,
    reads: (app) => [
      http.get(`/api/pdp/apps/${app}/policies/doc-access`, () =>
        HttpResponse.json({ ...head(app), activeVersion: 1 }),
      ),
      http.get(`/api/pdp/apps/${app}/policies/doc-access/versions`, () =>
        HttpResponse.json({
          data: [V1],
          pagination: { page: 1, size: 50, totalPages: 1, totalElements: 1 },
        }),
      ),
      http.get(`/api/pdp/apps/${app}/policies/doc-access/versions/1`, () =>
        HttpResponse.json(V1),
      ),
      http.get(`/api/pdp/apps/${app}/action-catalogue/document`, () =>
        HttpResponse.json({
          app,
          resourceType: "document",
          actions: ["read"],
          revision: 1,
        }),
      ),
    ],
    target: { method: "put", path: (app) => `/api/pdp/apps/${app}/policies/doc-access` },
    act: async () => {
      const user = userEvent.setup();
      await screen.findByDisplayValue("document");
      await user.type(screen.getByLabelText("Motivo del cambio"), "why");
      await user.click(screen.getByText(/Guardar como v2/));
    },
  },
  {
    name: "write · configuration replace (PUT)",
    ui: () => <ConfigScreen />,
    reads: (app) => [
      http.get(`/api/pdp/apps/${app}/configuration`, () =>
        HttpResponse.json({
          app,
          subjectAttributes: { roles: "realm_access.roles" },
          pip: null,
          revision: 4,
        }),
      ),
    ],
    target: { method: "put", path: (app) => `/api/pdp/apps/${app}/configuration` },
    act: async (app) => {
      fireEvent.change(screen.getByLabelText("App"), { target: { value: app } });
      await screen.findByDisplayValue("realm_access.roles");
      await userEvent.setup().click(screen.getByText("Guardar"));
    },
  },
  {
    name: "write · catalogue create (POST)",
    ui: () => <CatalogueScreen />,
    reads: (app) => [
      http.get(`/api/pdp/apps/${app}/action-catalogue`, () =>
        HttpResponse.json({ data: [] }),
      ),
    ],
    target: { method: "post", path: (app) => `/api/pdp/apps/${app}/action-catalogue` },
    act: async (app) => {
      const user = userEvent.setup();
      fireEvent.change(screen.getByLabelText("App"), { target: { value: app } });
      const resourceType = await screen.findByPlaceholderText("document");
      fireEvent.change(resourceType, { target: { value: "document" } });
      fireEvent.change(screen.getByPlaceholderText("verbo"), {
        target: { value: "read" },
      });
      await user.click(screen.getByText("+ acción"));
      await user.click(screen.getByText("Declarar"));
    },
  },
  {
    name: "write · catalogue replace (PUT)",
    ui: () => <CatalogueScreen />,
    reads: (app) => [
      http.get(`/api/pdp/apps/${app}/action-catalogue`, () =>
        HttpResponse.json({
          data: [{ app, resourceType: "document", actions: ["read"], revision: 1 }],
        }),
      ),
    ],
    target: {
      method: "put",
      path: (app) => `/api/pdp/apps/${app}/action-catalogue/document`,
    },
    act: async (app) => {
      const user = userEvent.setup();
      fireEvent.change(screen.getByLabelText("App"), { target: { value: app } });
      await user.click(await screen.findByText("Editar"));
      await user.click(screen.getByText("Guardar"));
    },
  },
  {
    name: "write · catalogue delete (DELETE)",
    ui: () => <CatalogueScreen />,
    reads: (app) => [
      http.get(`/api/pdp/apps/${app}/action-catalogue`, () =>
        HttpResponse.json({
          data: [{ app, resourceType: "document", actions: ["read"], revision: 1 }],
        }),
      ),
    ],
    target: {
      method: "delete",
      path: (app) => `/api/pdp/apps/${app}/action-catalogue/document`,
    },
    act: async (app) => {
      const user = userEvent.setup();
      fireEvent.change(screen.getByLabelText("App"), { target: { value: app } });
      await user.click(await screen.findByText("Borrar"));
      await user.click(screen.getByText("Confirmar borrado"));
    },
  },
  {
    name: "write · configuration create (POST)",
    ui: () => <ConfigScreen />,
    reads: (app) => [
      // No configuration yet: a 404 is a normal state, and it offers to create one.
      http.get(`/api/pdp/apps/${app}/configuration`, () =>
        HttpResponse.json(
          { title: "Not found", status: 404, code: "APP_CONFIG_NOT_FOUND" },
          { status: 404 },
        ),
      ),
    ],
    target: { method: "post", path: (app) => `/api/pdp/apps/${app}/configuration` },
    act: async (app) => {
      const user = userEvent.setup();
      fireEvent.change(screen.getByLabelText("App"), { target: { value: app } });
      await user.click(await screen.findByText("Crear configuración"));
      if (screen.queryAllByPlaceholderText("atributo").length === 0) {
        await user.click(screen.getByText("+ atributo"));
      }
      fireEvent.change(screen.getAllByPlaceholderText("atributo")[0], {
        target: { value: "roles" },
      });
      fireEvent.change(screen.getAllByPlaceholderText("claim path")[0], {
        target: { value: "realm_access.roles" },
      });
      await user.click(screen.getByText("Guardar"));
    },
  },
  {
    name: "write · configuration delete (DELETE)",
    ui: () => <ConfigScreen />,
    reads: (app) => [
      http.get(`/api/pdp/apps/${app}/configuration`, () =>
        HttpResponse.json({
          app,
          subjectAttributes: { roles: "realm_access.roles" },
          pip: null,
          revision: 4,
        }),
      ),
    ],
    target: { method: "delete", path: (app) => `/api/pdp/apps/${app}/configuration` },
    act: async (app) => {
      const user = userEvent.setup();
      fireEvent.change(screen.getByLabelText("App"), { target: { value: app } });
      await user.click(await screen.findByText("Borrar configuración"));
      await user.click(screen.getByText("Confirmar borrado"));
    },
  },
];

type Scenario = {
  app: string;
  body: string;
  /** What /api/session lists. */
  sessionApps: string[];
  /** What the auth port's user carries — the session's second source. */
  tokenApps: string[];
};

/** Both sources truthful: neither lists the application under test. */
const TRUTHFUL = { sessionApps: SESSION, tokenApps: SESSION };

/**
 * The values the surfaces above put where a path carries a variable. A refused
 * path is recorded with these replaced by {}, so it can be compared with a
 * request's own template rather than with a pattern — see pathTemplate below.
 *
 * The collapse is by VALUE, not by position: a segment a surface wrote as a
 * LITERAL is collapsed too, whenever it happens to equal one of these. So the
 * matching is exact only while no enumerated request writes one of these values
 * as a literal segment of its own. The last test asserts that, rather than
 * leaving it to the fact that today none does.
 */
const FIXTURES = new Set([NOT_HELD, NONEXISTENT, "doc-access", "document", "1"]);

/** `/api/pdp/apps/archive/policies/doc-access` → `/api/pdp/apps/{}/policies/{}`. */
function refusedTemplate(path: string): string {
  return path
    .split("/")
    .map((segment) => (FIXTURES.has(segment) ? "{}" : segment))
    .join("/");
}

/**
 * Every request answered with a 403 on a surface that then rendered the
 * refusal, as "METHOD /path-template". The last test checks it against the
 * requests the browser can make.
 */
const refusedRequests = new Set<string>();

/**
 * Render one surface under one scenario and return the container's HTML,
 * untouched. Asserts on the way that the refusal was actually reached (a
 * surface's target was sent) and that the element carrying the sentence carries
 * nothing else.
 */
async function renderRefused(surface: Surface, scenario: Scenario): Promise<string> {
  let targeted = 0;
  const refusedHere: string[] = [];
  const refusing =
    (body: string) =>
    ({ request }: { request: Request }) => {
      refusedHere.push(
        `${request.method} ${refusedTemplate(new URL(request.url).pathname)}`,
      );
      return refuse(body)();
    };
  port.apps = scenario.tokenApps;
  server.use(
    http.get("/api/session", () =>
      HttpResponse.json({ sub: "someone", apps: scenario.sessionApps }),
    ),
  );
  if (surface.target) {
    const { method, path } = surface.target;
    const answer = refusing(scenario.body);
    server.use(
      ...(surface.reads?.(scenario.app) ?? []),
      http[method](path(scenario.app), (info) => {
        targeted++;
        return answer(info);
      }),
      // Any read the surface did not declare is refused too.
      http.all(/\/api\/pdp\//, refusing(scenario.body)),
    );
  } else {
    server.use(http.all(/\/api\/pdp\//, refusing(scenario.body)));
  }

  const { container, unmount } = render(surface.ui(scenario.app));
  await surface.act?.(scenario.app);
  if (surface.target) await waitFor(() => expect(targeted).toBeGreaterThan(0));
  await waitFor(() => expect(screen.getAllByText(FORBIDDEN).length).toBeGreaterThan(0));
  // Let the session query and any follow-up render settle.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const html = container.innerHTML;
  for (const element of screen.getAllByText(FORBIDDEN)) {
    expect(element.textContent).toBe(FORBIDDEN);
  }
  unmount();
  for (const request of refusedHere) refusedRequests.add(request);
  return html;
}

afterEach(() => {
  port.apps = null;
});

/** React's generated ids: a counter across renders, not content. */
const ids = (html: string) =>
  html.replace(/_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:/g, "{id}");

/** The one substitution the cross-application comparison needs. */
const named = (html: string, app: string) =>
  ids(html).replaceAll(app, "{app}").replaceAll(encodeURIComponent(app), "{app}");

/** The only places the session may reach: the selector and the datalists. */
const withoutSelector = (html: string) =>
  html
    .replace(/<nav aria-label="Aplicaciones"[\s\S]*?<\/nav>/g, "<nav/>")
    .replace(/<datalist[\s\S]*?<\/datalist>/g, "<datalist/>");

describe("a refusal is rendered from the status alone — the body changes nothing", () => {
  it.each(SURFACES)("$name", async (surface) => {
    const literal = await renderRefused(surface, {
      app: NOT_HELD,
      body: ENGINE_REFUSAL_BODY,
      ...TRUTHFUL,
    });
    expect(literal).toContain(FORBIDDEN);

    for (const leak of LEAKS) {
      const leaked = await renderRefused(surface, {
        app: NOT_HELD,
        body: leakBody(leak, NOT_HELD),
        ...TRUTHFUL,
      });
      // No normalisation beyond React's ids.
      expect(ids(leaked), leak.name).toEqual(ids(literal));
      for (const needle of BODY_NEEDLES) {
        expect(leaked, `${leak.name}: ${needle}`).not.toContain(needle);
      }
    }
    for (const needle of BODY_NEEDLES) {
      expect(literal, needle).not.toContain(needle);
    }
  });
});

describe("a refusal renders identically whether or not the application exists", () => {
  it.each(SURFACES)("$name", async (surface) => {
    const notHeld = await renderRefused(surface, {
      app: NOT_HELD,
      body: ENGINE_REFUSAL_BODY,
      ...TRUTHFUL,
    });
    const nonexistent = await renderRefused(surface, {
      app: NONEXISTENT,
      body: ENGINE_REFUSAL_BODY,
      ...TRUTHFUL,
    });

    expect(named(nonexistent, NONEXISTENT)).toEqual(named(notHeld, NOT_HELD));
  });

  it("the comparison can fail: a different engine answer renders differently", async () => {
    // The instrument's positive control. Were the substitution so aggressive
    // that any two renders compared equal, every row above would pass on a
    // console that leaked. A 404 for the application that does not exist — the
    // answer an enumerating engine would give — must NOT look like the refusal.
    const refused = await renderRefused(DETAIL, {
      app: NOT_HELD,
      body: ENGINE_REFUSAL_BODY,
      ...TRUTHFUL,
    });

    server.use(
      http.all(/\/api\/pdp\//, () =>
        HttpResponse.json(
          {
            title: "Not found",
            status: 404,
            code: "POLICY_NOT_FOUND",
            detail: "no such policy",
          },
          { status: 404 },
        ),
      ),
    );
    const { container, unmount } = render(DETAIL.ui(NONEXISTENT));
    await screen.findByText("no such policy");
    const notFound = named(container.innerHTML, NONEXISTENT);
    unmount();

    expect(notFound).not.toEqual(named(refused, NOT_HELD));
  });
});

/** Each way the session can list the application the engine refused. */
const LISTINGS: { name: string; sessionApps: string[]; tokenApps: string[] }[] = [
  { name: "/api/session", sessionApps: [...SESSION, NOT_HELD], tokenApps: SESSION },
  { name: "the auth port", sessionApps: SESSION, tokenApps: [...SESSION, NOT_HELD] },
  {
    name: "both",
    sessionApps: [...SESSION, NOT_HELD],
    tokenApps: [...SESSION, NOT_HELD],
  },
];

describe("the session is advisory — listing the application changes only the selector", () => {
  it.each(SURFACES)("$name", async (surface) => {
    const truthful = await renderRefused(surface, {
      app: NOT_HELD,
      body: ENGINE_REFUSAL_BODY,
      ...TRUTHFUL,
    });
    for (const listing of LISTINGS) {
      const listed = await renderRefused(surface, {
        app: NOT_HELD,
        body: ENGINE_REFUSAL_BODY,
        sessionApps: listing.sessionApps,
        tokenApps: listing.tokenApps,
      });

      expect(ids(withoutSelector(listed)), `listed by ${listing.name}`).toEqual(
        ids(withoutSelector(truthful)),
      );
    }
  });

  it("the cross-application view renders the engine's empty page whatever the session lists", async () => {
    port.apps = [NOT_HELD, ...SESSION];
    server.use(
      http.get("/api/session", () =>
        HttpResponse.json({ sub: "someone", apps: [NOT_HELD, ...SESSION] }),
      ),
      http.get("/api/pdp/policies", () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, size: 50, totalPages: 0, totalElements: 0 },
        }),
      ),
    );

    render(<PoliciesScreen />);

    expect(
      await screen.findByText("No hay políticas que puedas leer."),
    ).toBeInTheDocument();
    // The selector offers what the session lists; nothing else is derived from it.
    expect(await screen.findByText(NOT_HELD)).toBeInTheDocument();
  });
});

/*
 * The positive controls for the two screens that had no test of their own. The
 * other screens' controls live beside them: CatalogueScreen.test,
 * ConfigScreen.test, EditPolicyScreen.test, PolicyTesterScreen.test and
 * LifecycleActions.test each render an application the caller may administer.
 */
describe("an application the caller may administer renders its data", () => {
  it("policy list: the rows of the application in the route", async () => {
    let requested = "";
    server.use(
      http.get("/api/pdp/apps/records/policies", ({ request }) => {
        requested = new URL(request.url).search;
        return HttpResponse.json({
          data: [
            {
              policyId: "doc-access",
              app: "records",
              resourceType: "document",
              activeVersion: 2,
              revision: 3,
              audit,
            },
          ],
          pagination: { page: 1, size: 50, totalPages: 1, totalElements: 1 },
        });
      }),
    );

    render(<AppPoliciesScreen app="records" />);

    expect((await screen.findAllByText("doc-access")).length).toBeGreaterThan(0);
    expect(screen.queryByText(FORBIDDEN)).not.toBeInTheDocument();
    // The app came from the route: the per-app path, not the merged catalogue.
    expect(requested).toBe("?page=1&size=50");
  });

  it("policy detail: the head of the policy", async () => {
    server.use(
      http.get("/api/pdp/apps/records/policies/doc-access", () =>
        HttpResponse.json(head("records")),
      ),
      http.get("/api/pdp/apps/records/policies/doc-access/versions", () =>
        HttpResponse.json({
          data: versions("records"),
          pagination: { page: 1, size: 50, totalPages: 1, totalElements: 1 },
        }),
      ),
    );

    render(<PolicyDetailScreen app="records" policyId="doc-access" />);

    expect(
      await screen.findByRole("heading", { name: "doc-access" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(FORBIDDEN)).not.toBeInTheDocument();
  });
});

/*
 * THE SURFACE LIST, DERIVED. Every request the browser can make is read from the
 * source: each apiGet/apiPost/apiPut/apiDelete call and each fetch, in every
 * file under src/ the browser can run. Each must have been refused on a surface
 * above that went on to render the refusal — or be named in NOT_ENGINE, with the
 * reason no 403 of the engine can answer it.
 *
 * WHAT THE READING REACHES. It reads source text; it is not a compiler. It
 * recognises TWO WRITTEN FORMS, and only those two: an apiGet/apiPost/apiPut/
 * apiDelete call with a literal path, and the word `fetch` written against the
 * parenthesis with a literal URL. Of those two it fails on one it cannot read
 * rather than dropping it — a path built by a helper, assembled from an imported
 * constant or carrying a nested template breaks the parity count below; a fetch
 * is filed by the method it states, and a fetch whose literal URL begins
 * /api/pdp/ fails outright, lib/pdp/client being its one outlet. It opens every
 * module file under src/ the browser can run — .ts and .tsx and the JavaScript
 * ones alike — the tests, the harness and NOT_BROWSER apart.
 * And it requires that each one was refused on a surface above, matching by the
 * path TEMPLATE both sides carry — with the caveat FIXTURES carries: the refused
 * side collapses a LITERAL segment too whenever its value is one of those five,
 * so a request that wrote such a value as a literal would be matched against a
 * template no surface meant to cover. No enumerated request does today, and the
 * last test asserts it rather than trusting it.
 *
 * ANY REQUEST NOT WRITTEN IN ONE OF THOSE TWO FORMS IS OUTSIDE ITS REACH, and no
 * test in this file says anything about it. That is what reading text means, and
 * not a list of the ways found so far: a call reached through a local binding —
 * `fetch`, or one of the api helpers — is the plainest of them, and no rule over
 * text closes it: only resolving the calls would. What helps beside this file is
 * narrower than that and is not this file's: biome.json denies XMLHttpRequest,
 * EventSource and navigator everywhere under src/, which keeps three transports
 * out of the browser code and is, again, text rather than an AST.
 *
 * One limit inside the reach, because the matching is by template and not by
 * call site: a request whose template is, segment for segment, one a surface
 * above already asks for is indistinguishable from that surface's own request,
 * and is taken as covered although nothing rendered it. A new screen calling the
 * existing per-application read is the honest case of that; a second outlet
 * forging the same path is the dishonest one. Only tying each refusal to the
 * call site that made it could separate them, which this instrument does not do.
 *
 * It runs last and reads what the comparisons above recorded, so it is only
 * meaningful when the whole file runs.
 */
const NOT_ENGINE: Record<string, string> = {
  "GET /api/session":
    "the BFF's own endpoint: it answers 200 or the BFF's 401, never the engine's 403, and names no application",
};

/**
 * The only two reasons a file the reading would otherwise open may be named
 * here. The harness (src/test) and the test files are left out elsewhere, by
 * browserSources. Two constants, and the type of NOT_BROWSER admits nothing
 * else, because a sentence nobody can check is a place to hide a request.
 * Exactly what that buys, and no more: the claim is now one of two rather than
 * any prose, and one of the two is checked in the one direction a reading can
 * check it — a file that ships "use client" runs in the browser and cannot
 * claim to run on the server (asserted below). Naming a file here still hides
 * what it calls, and a file WITHOUT the directive can still reach the browser
 * through a client component's imports, which nothing here catches. The
 * boundary stays declared; it is only narrower than a free sentence.
 */
const RUNS_ON_THE_SERVER = "runs on the server: no screen renders its answer";
const IS_THE_TRANSPORT =
  "is the transport itself: every call enumerated here ends in its fetch, which is not a second request";

/**
 * Files under src/ the derivation does not read. A file that is neither of the
 * two kinds belongs in the reading, whatever layer it sits in.
 */
const NOT_BROWSER: Record<string, typeof RUNS_ON_THE_SERVER | typeof IS_THE_TRANSPORT> = {
  // The one outlet: its three fetches are where the enumerated calls end.
  "src/lib/pdp/client.ts": IS_THE_TRANSPORT,
  // The BFF's own call to the engine, made by the route handler.
  "src/lib/pdp/server.ts": RUNS_ON_THE_SERVER,
  // Token verification: it talks to the identity provider, never to /api/pdp.
  "src/lib/auth/server.ts": RUNS_ON_THE_SERVER,
};

type BrowserRequest = { request: string; template: string; file: string };

function browserSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    const file = relative(process.cwd(), path);
    // src/test is the harness: it ships nowhere and every request in it is a stub.
    if (entry.isDirectory()) return file === "src/test" ? [] : browserSources(path);
    const code = /\.[cm]?[jt]sx?$/.test(entry.name);
    if (!code || /\.test\.[cm]?[jt]sx?$/.test(entry.name)) return [];
    return NOT_BROWSER[file] ? [] : [path];
  });
}

/** `apps/${app}/policies/${policyId}?page=1` → `apps/{}/policies/{}`. */
function pathTemplate(template: string): string {
  return template
    .split("?")[0]
    .split("/")
    .map((segment) => (segment.includes("${") ? "{}" : segment))
    .join("/");
}

function browserRequests(): BrowserRequest[] {
  for (const [file, reason] of Object.entries(NOT_BROWSER)) {
    expect(existsSync(file), `${file}: named in NOT_BROWSER, absent from the tree`).toBe(
      true,
    );
    expect(
      reason === RUNS_ON_THE_SERVER &&
        /^\s*["']use client["']/m.test(readFileSync(file, "utf8")),
      `${file}: named in NOT_BROWSER as a file that ${RUNS_ON_THE_SERVER}, but it carries "use client"`,
    ).toBe(false);
  }
  const requests: BrowserRequest[] = [];
  for (const path of browserSources(join(process.cwd(), "src"))) {
    const source = readFileSync(path, "utf8");
    const file = relative(process.cwd(), path);
    // The calls are counted WITHOUT reading the type argument, so one whose type
    // argument this parser cannot read fails the parity below rather than
    // disappearing from the enumeration.
    const calls = [...source.matchAll(/\bapi(?:Get|Post|Put|Delete)\s*[<(]/g)];
    const templated = [
      ...source.matchAll(
        /\bapi(Get|Post|Put|Delete)\s*(?:<[^`]*?>)?\s*\(\s*`([^`]+)`\s*[,)]/g,
      ),
    ];
    // A path that is not a template literal would escape the enumeration.
    expect(templated.length, `${file}: every api call takes a literal path`).toBe(
      calls.length,
    );
    for (const [, verb, template] of templated) {
      const method = verb.toUpperCase();
      requests.push({
        request: `${method} /api/pdp/${template}`,
        template: `${method} ${pathTemplate(`/api/pdp/${template}`)}`,
        file,
      });
    }
    const fetches = [...source.matchAll(/\bfetch\s*\(/g)];
    const literal = [...source.matchAll(/\bfetch\s*\(\s*["'`]([^"'`]+)["'`]/g)];
    expect(literal.length, `${file}: every fetch takes a literal path`).toBe(
      fetches.length,
    );
    for (const [index, match] of literal.entries()) {
      const url = match[1];
      // The engine has one outlet. A raw fetch to it would carry its own headers
      // and its own error, and no surface above is rendering that.
      expect(
        url.startsWith("/api/pdp/"),
        `${file}: ${url} — a request to the engine goes through lib/pdp/client`,
      ).toBe(false);
      // A fetch carries a method; a write filed as a read would be matched
      // against the refusals of a verb it never uses.
      const options = source.slice(
        (match.index ?? 0) + match[0].length,
        literal[index + 1]?.index ?? source.length,
      );
      const method = options.match(/\bmethod\s*:\s*["'`]([A-Za-z]+)["'`]/);
      expect(
        /\bmethod\s*:/.test(options) === (method !== null),
        `${file}: ${url} — every fetch states its method as a literal`,
      ).toBe(true);
      const verb = (method?.[1] ?? "GET").toUpperCase();
      requests.push({
        request: `${verb} ${url}`,
        template: `${verb} ${pathTemplate(url)}`,
        file,
      });
    }
  }
  return requests;
}

describe("the instrument reaches every request the browser can make", () => {
  it("each request was refused on a surface, or cannot be refused by the engine", () => {
    const requests = browserRequests();
    expect(requests.length).toBeGreaterThan(0);

    // The premise of the matching (see FIXTURES): the refused side collapses a
    // literal segment whose value is a fixture value, so a request that wrote
    // one would be compared against a template no surface meant to cover.
    const collisions = requests.flatMap(({ request, file }) =>
      request
        .split("?")[0]
        .split("/")
        .filter((segment) => !segment.includes("${") && FIXTURES.has(segment))
        .map((segment) => `${segment} — ${request}  (${file})`),
    );
    expect(collisions, "a literal segment is a FIXTURES value").toEqual([]);

    const unreached = requests.filter(
      ({ request, template }) => !NOT_ENGINE[request] && !refusedRequests.has(template),
    );

    expect(
      unreached.map(({ request, file }) => `${request}  (${file})`),
      "requests no surface refused",
    ).toEqual([]);
  });
});
