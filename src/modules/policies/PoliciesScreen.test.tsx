import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type { Paginated, PolicyHeadSummary } from "@/lib/pdp/contracts";
import { engineRefusal, POLICIES_FIXTURE } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { render, screen, waitFor, within } from "@/test/render";
import { PoliciesScreen } from "./PoliciesScreen";

describe("PoliciesScreen — the cross-application view", () => {
  it("renders policies from the BFF, including INACTIVE heads", async () => {
    render(<PoliciesScreen />);

    expect(await screen.findAllByText("doc-access")).not.toHaveLength(0);
    // The control plane must show what is NOT in production yet:
    expect((await screen.findAllByText("inactiva")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("activa · v2")).length).toBeGreaterThan(0);
  });

  it("renders the engine's totals and pages as given, not a count of the rows", async () => {
    // Two rows on this page, 137 in total across 3 pages: a screen that counted
    // what it received would say 2.
    server.use(
      http.get("/api/pdp/policies", () =>
        HttpResponse.json<Paginated<PolicyHeadSummary>>({
          data: POLICIES_FIXTURE,
          pagination: { page: 2, size: 50, totalPages: 3, totalElements: 137 },
        }),
      ),
    );

    render(<PoliciesScreen />);

    expect(await screen.findByText("137 políticas")).toBeInTheDocument();
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();
  });

  it("asks the engine for the next page instead of paging locally", async () => {
    const pagesAsked: string[] = [];
    server.use(
      http.get("/api/pdp/policies", ({ request }) => {
        const page = new URL(request.url).searchParams.get("page") ?? "";
        pagesAsked.push(page);
        return HttpResponse.json<Paginated<PolicyHeadSummary>>({
          data: POLICIES_FIXTURE,
          pagination: { page: Number(page), size: 50, totalPages: 2, totalElements: 60 },
        });
      }),
    );
    render(<PoliciesScreen />);

    await screen.findByText("Página 1 de 2");
    await userEvent.setup().click(screen.getByText("Siguiente"));

    expect(await screen.findByText("Página 2 de 2")).toBeInTheDocument();
    expect(pagesAsked).toEqual(["1", "2"]);
  });

  it("shows every row the engine returned — there is no client-side filter", async () => {
    render(<PoliciesScreen />);

    // Both applications' rows, in the one table the engine's page fills.
    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(3));
    expect(within(table).getByText("records")).toBeInTheDocument();
    expect(within(table).getByText("billing")).toBeInTheDocument();
  });

  it("says an empty page means no rows you may read — not that nothing exists", async () => {
    server.use(
      http.get("/api/pdp/policies", () =>
        HttpResponse.json<Paginated<PolicyHeadSummary>>({
          data: [],
          pagination: { page: 1, size: 50, totalPages: 0, totalElements: 0 },
        }),
      ),
    );

    render(<PoliciesScreen />);

    expect(
      await screen.findByText("No hay políticas que puedas leer."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Aún no hay políticas/)).not.toBeInTheDocument();
  });

  it("offers the session's applications, each leading to its own route", async () => {
    render(<PoliciesScreen />);

    const selector = await screen.findByRole("navigation", { name: "Aplicaciones" });
    const records = await within(selector).findByText("records");
    expect(records.closest("a")).toHaveAttribute("href", "/policies/records");
    expect(within(selector).getByText("billing").closest("a")).toHaveAttribute(
      "href",
      "/policies/billing",
    );
  });

  it("renders a 403 as the one refusal sentence, never as a session error", async () => {
    // Not expected from a scoped engine (an empty scope is a 200), but if it
    // comes it is still a refusal, and it is rendered as one.
    server.use(http.get("/api/pdp/policies", () => engineRefusal()));

    render(<PoliciesScreen />);

    expect(
      await screen.findByText("No puedes administrar esta aplicación."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/sesión/)).not.toBeInTheDocument();
  });
});
