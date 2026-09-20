/*
 * The BFF's own 401 is the only answer that ends the session. A 403 is a
 * normal refusal and must never sign anyone out; a 401 the engine sent is a
 * deployment fault, rendered as one, and must not sign anyone out either.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiPost } from "@/lib/pdp/client";
import { PolicyDetailScreen } from "@/modules/policies/PolicyDetailScreen";
import { PolicyTesterScreen } from "@/modules/policies/PolicyTesterScreen";
import { engineRefusal } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { render, screen } from "@/test/render";
import { SessionGuard } from "./SessionGuard";

const logout = vi.fn();

vi.mock("@/lib/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...original,
    useAuth: () => ({ ...original.useAuth(), logout }),
  };
});

const UNAUTHENTICATED = () =>
  HttpResponse.json(
    {
      title: "Unauthorized",
      status: 401,
      code: "UNAUTHENTICATED",
      detail: "A valid Bearer token is required.",
    },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );

/*
 * 401s the engine sends, as the BFF passes them through (status and body
 * copied, content-type defaulted): the OIDC layer's, which has no body — what a
 * token without the engine's audience gets — and the engine's own, whose code
 * is UNAUTHORIZED (service-policy 0.6.1, AuthContext).
 */
const ENGINE_401S = [
  [
    "the OIDC layer's, with no body",
    () =>
      new HttpResponse(null, {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
  ],
  [
    "the engine's own, coded UNAUTHORIZED",
    () =>
      HttpResponse.json(
        {
          type: "about:blank",
          code: "UNAUTHORIZED",
          title: "Unauthorized",
          status: 401,
          detail: "no usable subject identity in token",
        },
        { status: 401, headers: { "content-type": "application/problem+json" } },
      ),
  ],
] as const;

const UPSTREAM_UNAUTHENTICATED =
  "El motor de políticas no aceptó tu sesión, aunque esta consola sí. Es una falla de configuración del despliegue (por ejemplo, al token le falta la audiencia del motor), no una sesión terminada. Avisa a quien opera esta consola.";
const SESSION_ENDED = "Tu sesión terminó. Cerrando sesión…";

function Reader() {
  const query = useQuery({
    queryKey: ["probe"],
    queryFn: () => apiGet("apps/records/policies", "token"),
  });
  return <p>{query.status}</p>;
}

function Writer() {
  const mutation = useMutation({
    mutationFn: () => apiPost("apps/records/policies", {}, "token"),
  });
  return (
    <>
      <button type="button" onClick={() => mutation.mutate()}>
        write
      </button>
      <p>{mutation.status}</p>
    </>
  );
}

beforeEach(() => {
  logout.mockReset();
});

describe("SessionGuard", () => {
  it("ends the session on a 401 from a read", async () => {
    server.use(http.get("/api/pdp/apps/records/policies", UNAUTHENTICATED));

    render(
      <>
        <SessionGuard />
        <Reader />
      </>,
    );

    expect(await screen.findByText("error")).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("ends the session on a 401 from a write", async () => {
    server.use(http.post("/api/pdp/apps/records/policies", UNAUTHENTICATED));
    render(
      <>
        <SessionGuard />
        <Writer />
      </>,
    );

    await userEvent.setup().click(screen.getByText("write"));

    expect(await screen.findByText("error")).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("does NOT end the session on the engine's 403", async () => {
    server.use(
      http.get("/api/pdp/apps/records/policies", () => engineRefusal()),
      http.post("/api/pdp/apps/records/policies", () => engineRefusal()),
    );
    render(
      <>
        <SessionGuard />
        <Reader />
        <Writer />
      </>,
    );

    await userEvent.setup().click(screen.getByText("write"));

    expect(await screen.findAllByText("error")).toHaveLength(2);
    expect(logout).not.toHaveBeenCalled();
  });

  it.each(
    ENGINE_401S,
  )("does NOT end the session on a 401 from the engine — %s", async (_, answer) => {
    server.use(
      http.get("/api/pdp/apps/records/policies", answer),
      http.post("/api/pdp/apps/records/policies", answer),
    );
    render(
      <>
        <SessionGuard />
        <Reader />
        <Writer />
      </>,
    );

    await userEvent.setup().click(screen.getByText("write"));

    expect(await screen.findAllByText("error")).toHaveLength(2);
    expect(logout).not.toHaveBeenCalled();
  });
});

describe("a 401 from the engine renders as a deployment fault", () => {
  it.each(ENGINE_401S)("on a read — %s", async (_, answer) => {
    server.use(http.all(/\/api\/pdp\//, answer));

    render(
      <>
        <SessionGuard />
        <PolicyDetailScreen app="records" policyId="doc-access" />
      </>,
    );

    expect(await screen.findByText(UPSTREAM_UNAUTHENTICATED)).toBeInTheDocument();
    expect(screen.queryByText(SESSION_ENDED)).not.toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
  });

  it.each(ENGINE_401S)("on a write — %s", async (_, answer) => {
    server.use(http.post("/api/pdp/apps/records/evaluate", answer));

    render(
      <>
        <SessionGuard />
        <PolicyTesterScreen app="records" />
      </>,
    );
    await userEvent.setup().click(screen.getByText("Evaluar"));

    expect(await screen.findByText(UPSTREAM_UNAUTHENTICATED)).toBeInTheDocument();
    expect(screen.queryByText(SESSION_ENDED)).not.toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
  });

  it("while the BFF's own 401 still reads as an ended session", async () => {
    server.use(http.all(/\/api\/pdp\//, UNAUTHENTICATED));

    render(
      <>
        <SessionGuard />
        <PolicyDetailScreen app="records" policyId="doc-access" />
      </>,
    );

    expect(await screen.findByText(SESSION_ENDED)).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
