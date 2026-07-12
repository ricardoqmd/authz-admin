/*
 * Regenerate typed PDP contracts from the live OpenAPI (ADR-015: the spec is
 * runtime-generated, never committed). Run with the PDP up in dev:
 *
 *   ./mvnw quarkus:dev          # in the service-policy repo
 *   pnpm generate:pdp-types     # here
 *
 * Output: src/lib/pdp/openapi.gen.ts (do not edit by hand).
 * Requires: pnpm add -D openapi-typescript
 */
import { execSync } from "node:child_process";

const url = process.env.PDP_BASE_URL ?? "http://localhost:8080";
execSync(
  `pnpm dlx openapi-typescript ${url}/q/openapi?format=json -o src/lib/pdp/openapi.gen.ts`,
  { stdio: "inherit" },
);
