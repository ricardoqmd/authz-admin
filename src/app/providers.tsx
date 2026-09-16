"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";
import { PublicConfigProvider } from "@/lib/config/context";
import type { PublicConfig } from "@/lib/config/public";
import { queryClient } from "@/lib/query";

/**
 * `config` is read on the server by the root layout and passed down, so the
 * browser receives the values of the environment this container is running in
 * rather than the ones its image was built with. The configuration provider
 * wraps the auth provider because the adapter needs the IdP coordinates on its
 * first render.
 */
export function Providers({
  config,
  children,
}: {
  config: PublicConfig;
  children: ReactNode;
}) {
  return (
    <PublicConfigProvider value={config}>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </AuthProvider>
    </PublicConfigProvider>
  );
}
