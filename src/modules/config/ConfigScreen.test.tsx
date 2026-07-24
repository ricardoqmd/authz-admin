import { fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "@/lib/pdp/contracts";
import { server } from "@/test/msw/server";
import { render, screen } from "@/test/render";
import { ConfigScreen } from "./ConfigScreen";

const CONFIG: AppConfig = {
  app: "kronia",
  subjectAttributes: { roles: "resource_access.kronia.roles" },
  pip: {
    url: "https://kronia.internal/{sub}",
    timeoutMs: 2000,
    cacheTtlSeconds: 60,
    credentialRef: "kronia-pdp-client",
  },
  revision: 4,
};

const configOk = (config: AppConfig) =>
  http.get("/api/pdp/apps/kronia/configuration", () => HttpResponse.json(config));

const config404 = () =>
  http.get("/api/pdp/apps/kronia/configuration", () =>
    HttpResponse.json(
      { title: "Not found", status: 404, code: "APP_CONFIG_NOT_FOUND" },
      { status: 404 },
    ),
  );

function selectApp() {
  fireEvent.change(screen.getByPlaceholderText("kronia"), {
    target: { value: "kronia" },
  });
}

describe("ConfigScreen", () => {
  it("shows the safe empty state on 404 and opens the create editor", async () => {
    server.use(config404());
    const user = userEvent.setup();
    render(<ConfigScreen />);
    selectApp();

    expect(await screen.findByText("Sin configuración")).toBeInTheDocument();
    await user.click(screen.getByText("Crear configuración"));
    expect(screen.getByText(/Configurar PIP/)).toBeInTheDocument();
  });

  it("prefills the loaded configuration (claim mapping + pip)", async () => {
    server.use(configOk(CONFIG));
    render(<ConfigScreen />);
    selectApp();

    expect(
      await screen.findByDisplayValue("resource_access.kronia.roles"),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://kronia.internal/{sub}")).toBeInTheDocument();
    expect(screen.getByDisplayValue("kronia-pdp-client")).toBeInTheDocument();
  });

  it("replaces the FULL configuration with a quoted If-Match", async () => {
    const captured: { body: unknown; ifMatch: string | null } = {
      body: null,
      ifMatch: null,
    };
    server.use(
      configOk(CONFIG),
      http.put("/api/pdp/apps/kronia/configuration", async ({ request }) => {
        captured.body = await request.json();
        captured.ifMatch = request.headers.get("if-match");
        return HttpResponse.json({ ...CONFIG, revision: 5 });
      }),
    );
    const user = userEvent.setup();
    render(<ConfigScreen />);
    selectApp();

    const claim = await screen.findByDisplayValue("resource_access.kronia.roles");
    fireEvent.change(claim, { target: { value: "resource_access.kronia.perms" } });
    await user.click(screen.getByText("Guardar"));

    await waitFor(() => expect(captured.body).not.toBeNull());
    expect(captured.ifMatch).toBe('"4"');
    expect(captured.body).toEqual({
      subjectAttributes: { roles: "resource_access.kronia.perms" },
      pip: {
        url: "https://kronia.internal/{sub}",
        timeoutMs: 2000,
        cacheTtlSeconds: 60,
        credentialRef: "kronia-pdp-client",
      },
    });
  });

  it("surfaces a 412 stale banner on save", async () => {
    server.use(
      configOk(CONFIG),
      http.put("/api/pdp/apps/kronia/configuration", () =>
        HttpResponse.json(
          { title: "Precondition failed", status: 412, code: "REVISION_MISMATCH" },
          { status: 412 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<ConfigScreen />);
    selectApp();

    await screen.findByDisplayValue("kronia-pdp-client");
    await user.click(screen.getByText("Guardar"));

    expect(
      await screen.findByText(/Otro admin cambió esta configuración/),
    ).toBeInTheDocument();
  });

  it("soft-warns when credentialRef looks like a secret", async () => {
    server.use(configOk(CONFIG));
    render(<ConfigScreen />);
    selectApp();

    const cred = await screen.findByDisplayValue("kronia-pdp-client");
    fireEvent.change(cred, {
      target: { value: "gAcE7s9kLmNoPqRsTuVwXyZ0123456789abcdefghij…" },
    });
    expect(screen.getByText(/parece un secreto/)).toBeInTheDocument();
  });
});
