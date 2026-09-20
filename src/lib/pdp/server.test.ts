/*
 * The upstream client has one credential to send, and it is the caller's.
 */
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { pdpFetch, UpstreamError } from "./server";

/** PDP_BASE_URL is unset in the test run, so the module's default applies. */
const PDP = "http://localhost:8080";

describe("pdpFetch", () => {
  it("sends the caller's token as the Bearer credential", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${PDP}/v1/policies`, ({ request }) => {
        seen.push(request.headers.get("authorization"));
        return HttpResponse.json({ ok: true });
      }),
    );

    await pdpFetch("caller.token.value", "/v1/policies");

    expect(seen).toEqual(["Bearer caller.token.value"]);
  });

  it("replaces any Authorization a call site passes, rather than keeping it", async () => {
    // The caller's token is the only credential this module may send: a header
    // smuggled in through `init` must not survive next to it or instead of it.
    const seen: (string | null)[] = [];
    server.use(
      http.post(`${PDP}/v1/apps/records/policies`, ({ request }) => {
        seen.push(request.headers.get("authorization"));
        return HttpResponse.json({ ok: true });
      }),
    );

    await pdpFetch("caller.token.value", "/v1/apps/records/policies", {
      method: "POST",
      headers: {
        authorization: "Bearer something-else",
        "content-type": "application/json",
      },
      body: "{}",
    });

    expect(seen).toEqual(["Bearer caller.token.value"]);
  });

  it("turns an unreachable engine into an UpstreamError", async () => {
    server.use(http.get(`${PDP}/v1/policies`, () => HttpResponse.error()));

    await expect(pdpFetch("t", "/v1/policies")).rejects.toBeInstanceOf(UpstreamError);
  });
});
