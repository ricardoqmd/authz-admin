import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type { CatalogueEntry } from "@/lib/pdp/contracts";
import { server } from "@/test/msw/server";
import { render, screen } from "@/test/render";
import { CatalogueScreen } from "./CatalogueScreen";

const emptyPolicies = () =>
  http.get("/api/pdp/policies", () =>
    HttpResponse.json({
      data: [],
      pagination: { page: 1, size: 50, totalPages: 0, totalElements: 0 },
    }),
  );

const STEPPER: CatalogueEntry = {
  app: "kronia",
  resourceType: "stepper",
  actions: ["create", "edit"],
  revision: 1,
};

async function selectApp() {
  const input = screen.getByPlaceholderText("kronia");
  fireEvent.change(input, { target: { value: "kronia" } });
}

describe("CatalogueScreen", () => {
  it("lists the vocabulary entries of the selected app", async () => {
    server.use(
      emptyPolicies(),
      http.get("/api/pdp/apps/kronia/action-catalogue", () =>
        HttpResponse.json({ data: [STEPPER] }),
      ),
    );
    render(<CatalogueScreen />);
    await selectApp();

    expect(await screen.findByText("stepper")).toBeInTheDocument();
    expect(screen.getByText("create")).toBeInTheDocument();
    expect(screen.getByText("edit")).toBeInTheDocument();
  });

  it("surfaces ACTION_IN_USE with the blocking policies on save", async () => {
    server.use(
      emptyPolicies(),
      http.get("/api/pdp/apps/kronia/action-catalogue", () =>
        HttpResponse.json({ data: [STEPPER] }),
      ),
      http.put("/api/pdp/apps/kronia/action-catalogue/stepper", () =>
        HttpResponse.json(
          {
            title: "Action in use",
            status: 409,
            code: "ACTION_IN_USE",
            policyIds: ["stepper-edit"],
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<CatalogueScreen />);
    await selectApp();

    await user.click(await screen.findByText("Editar"));
    await user.click(screen.getByText("Guardar"));

    expect(await screen.findByText(/políticas activas la usan/)).toBeInTheDocument();
    const link = screen.getByText("stepper-edit");
    expect(link.closest("a")).toHaveAttribute("href", "/policies/kronia/stepper-edit");
  });

  it("declares a new resource type", async () => {
    const captured: { body: { resourceType: string; actions: string[] } | null } = {
      body: null,
    };
    server.use(
      emptyPolicies(),
      http.get("/api/pdp/apps/kronia/action-catalogue", () =>
        HttpResponse.json({ data: [] }),
      ),
      http.post("/api/pdp/apps/kronia/action-catalogue", async ({ request }) => {
        captured.body = (await request.json()) as {
          resourceType: string;
          actions: string[];
        };
        return HttpResponse.json({
          ...STEPPER,
          resourceType: "document",
          actions: ["read"],
        });
      }),
    );
    const user = userEvent.setup();
    render(<CatalogueScreen />);
    await selectApp();

    const rt = await screen.findByPlaceholderText("document");
    fireEvent.change(rt, { target: { value: "document" } });
    const action = screen.getByPlaceholderText("verbo");
    fireEvent.change(action, { target: { value: "read" } });
    await user.click(screen.getByText("+ acción"));
    await user.click(screen.getByText("Declarar"));

    expect(captured.body).toEqual({ resourceType: "document", actions: ["read"] });
  });
});
