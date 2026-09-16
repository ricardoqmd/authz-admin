"use client";

/*
 * Delivery of the public runtime configuration to client components.
 *
 * The value is produced on the server by ./public.ts and passed down from the
 * root layout as a prop. Client code reads it through this hook and never
 * through `process.env`, which in the browser holds only what the build
 * inlined — the very thing this arrangement exists to avoid.
 */

import { createContext, type ReactNode, useContext } from "react";
import type { PublicConfig } from "./public";

const PublicConfigContext = createContext<PublicConfig | null>(null);

export function PublicConfigProvider({
  value,
  children,
}: {
  value: PublicConfig;
  children: ReactNode;
}) {
  return (
    <PublicConfigContext.Provider value={value}>{children}</PublicConfigContext.Provider>
  );
}

/**
 * Throws rather than returning an empty configuration. A missing provider means
 * the value never left the server, which is a wiring bug; a component that
 * quietly carried on with nothing would present it as a misconfigured
 * deployment instead, and send whoever debugs it to the wrong place.
 */
export function usePublicConfig(): PublicConfig {
  const value = useContext(PublicConfigContext);
  if (!value) {
    throw new Error(
      "usePublicConfig() was called outside <PublicConfigProvider>. The public " +
        "configuration is produced on the server and passed down from the root layout.",
    );
  }
  return value;
}
