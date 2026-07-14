import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";
import es from "../../messages/es.json";

/**
 * Custom render with every app provider: fresh QueryClient per test (no
 * cross-test cache), mock auth (NEXT_PUBLIC_AUTH_ADAPTER defaults to "mock"
 * in tests), and Spanish messages (the department's locale).
 */
export function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Providers({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="es" messages={es} timeZone="America/Mexico_City">
        <AuthProvider>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </AuthProvider>
      </NextIntlClientProvider>
    );
  }

  return rtlRender(ui, { wrapper: Providers });
}

export * from "@testing-library/react";
