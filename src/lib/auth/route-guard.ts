/*
 * The door check every API route shares.
 *
 * Extracted from the PDP proxy when a second route (the session endpoint) needed
 * the same answer. One implementation on purpose: the 401 body is deliberately
 * identical across every rejection reason, and two copies of that body are two
 * things that can drift apart — at which point the difference between them becomes
 * the side channel the body refuses to be.
 *
 * Server-only, like lib/auth/server.ts: nothing here may be imported from a client
 * component.
 */
import { NextResponse } from "next/server";
import { TokenError, type VerifiedUser, verifyCaller } from "./server";

/**
 * Authenticate the caller, or produce the response that refuses them.
 *
 * Returns the verified user on success and a ready-to-send NextResponse on
 * failure, so a handler cannot forget to stop: `instanceof NextResponse` is
 * the only way past it. Fail closed — there is no path through this function
 * that yields a user without a verified token.
 *
 * A misconfigured deployment answers 500, never 401 and never "allow": a
 * missing env var is our fault, not the caller's, and must not be mistakable
 * for a bad token in the logs.
 */
export async function authenticate(req: {
  headers: { get(name: string): string | null };
}): Promise<VerifiedUser | NextResponse> {
  try {
    return await verifyCaller(req);
  } catch (error) {
    if (!(error instanceof TokenError)) throw error;
    if (error.reason === "misconfigured") {
      console.error(`[pap-bff] ${error.message}`);
      return NextResponse.json(
        {
          title: "Server misconfigured",
          status: 500,
          code: "BFF_MISCONFIGURED",
          detail: "Caller token verification is not configured.",
        },
        { status: 500 },
      );
    }
    // Server-side only, and only the reason: no token, no claim, no subject.
    // Without it the first production 401 is undiagnosable; with anything more
    // than the reason it becomes a leak.
    console.warn(`[pap-bff] rejected caller: ${error.reason}`);
    // One body for every rejection reason. Which check failed (absent,
    // expired, bad signature, wrong client) stays server-side: telling an
    // anonymous caller narrows their next guess for free. Never echo the
    // token or any claim.
    return NextResponse.json(
      {
        title: "Unauthorized",
        status: 401,
        code: "UNAUTHENTICATED",
        detail: "A valid Bearer token is required.",
      },
      // RFC 6750 §3: a bearer-token resource announces the scheme on a 401.
      // Header only — bare `Bearer`, with no realm or error code, so the body
      // stays byte-identical across all four rejection reasons and the header
      // does not become the side channel the body refuses to be.
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }
}
