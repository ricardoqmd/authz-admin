import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "@/test/msw/server";
import { render, screen } from "@/test/render";
import { CatalogueActionsField } from "./CatalogueActionsField";

const entry = (actions: string[]) =>
  http.get("/api/pdp/apps/kronia/action-catalogue/stepper", () =>
    HttpResponse.json({
      app: "kronia",
      resourceType: "stepper",
      actions,
      revision: 1,
    }),
  );

describe("CatalogueActionsField", () => {
  it("toggles catalogue actions into the comma-separated value", async () => {
    server.use(entry(["create", "edit", "submit"]));
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <CatalogueActionsField
        app="kronia"
        resourceType="stepper"
        value="create"
        onChange={onChange}
      />,
    );

    // "edit" checkbox appears once the vocabulary loads.
    const editBox = await screen.findByRole("checkbox", { name: /edit/ });
    await user.click(editBox);
    // Emitted in catalogue order.
    expect(onChange).toHaveBeenLastCalledWith("create, edit");
  });

  it("the 'all' toggle emits * and previews the expansion", async () => {
    server.use(entry(["create", "edit"]));
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <CatalogueActionsField
        app="kronia"
        resourceType="stepper"
        value="create"
        onChange={onChange}
      />,
    );

    await user.click(await screen.findByRole("checkbox", { name: /todas/ }));
    expect(onChange).toHaveBeenLastCalledWith("*");
  });

  it("prompts to declare when the resource type has no vocabulary", async () => {
    server.use(
      http.get("/api/pdp/apps/kronia/action-catalogue/invoice", () =>
        HttpResponse.json(
          { title: "Not found", status: 404, code: "CATALOGUE_ENTRY_NOT_FOUND" },
          { status: 404 },
        ),
      ),
    );
    render(
      <CatalogueActionsField
        app="kronia"
        resourceType="invoice"
        value="*"
        onChange={vi.fn()}
      />,
    );

    const link = await screen.findByText("Declarar vocabulario");
    expect(link.closest("a")).toHaveAttribute("href", "/catalogue?app=kronia");
  });
});
