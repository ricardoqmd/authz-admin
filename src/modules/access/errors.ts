"use client";

import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/pdp/client";

/**
 * The engine refused: this caller may not do this to this application.
 *
 * A NORMAL outcome, not a failure of the session. And deliberately the only
 * thing read from it is the status: the engine answers an application the
 * caller does not hold and an application that does not exist with the same
 * bytes (service-policy ADR-033 §2), and a console that looked any further —
 * at the detail, at the application, at whether it "seems" to exist — could
 * only ever render the two differently, handing back what the engine refused
 * to disclose.
 */
export function isRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

/**
 * The session is over: THIS console's BFF no longer accepts the token. The only
 * answer that ends it.
 *
 * Not every `401` is that answer. The BFF passes the engine's answers through
 * unchanged, so a `401` can also come from the engine — a token this BFF
 * verified and the engine did not accept, typically because it lacks the
 * engine's audience. That is a deployment fault, not an ended session: signing
 * out would not fix it, the next token would be refused the same way, and the
 * person would be logged out on every request with the cause hidden. So the
 * BFF's own `401` is recognised by its code, `UNAUTHENTICATED`
 * (lib/auth/route-guard.ts). The engine does not send that code: at
 * service-policy 0.6.1 its own `401` is `UNAUTHORIZED`, and the OIDC layer's
 * has no body.
 */
export function endsSession(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 401 &&
    error.problem?.code === "UNAUTHENTICATED"
  );
}

/** A `401` that is not the BFF's: the engine refused a token the BFF accepted. */
export function isUpstreamUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && !endsSession(error);
}

/**
 * One sentence for any request failure, for the banners and inline notes that
 * render a single line. A refusal is always the same sentence, whatever the
 * engine's detail says and whatever application is involved.
 */
export function useDescribeError(): (error: unknown) => string {
  const t = useTranslations("access");
  return (error: unknown) => {
    if (isRefusal(error)) return t("forbidden");
    if (endsSession(error)) return t("sessionEnded");
    if (isUpstreamUnauthenticated(error)) return t("upstreamUnauthenticated");
    if (error instanceof ApiError && error.problem) {
      return error.problem.detail ?? error.problem.title;
    }
    return error instanceof Error ? error.message : String(error);
  };
}
