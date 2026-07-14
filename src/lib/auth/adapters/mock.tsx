"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { AuthApi, SessionUser } from "../types";

/**
 * Mock adapter — development and tests without an IdP (and the CI renderer).
 * Guarded against production use in ../index.tsx (fail-fast).
 * Neutral demo values only — real app names belong to the internal deployment.
 */
const MOCK_USER: SessionUser = {
  sub: "mock-admin",
  name: "Admin (mock)",
  roles: ["pap-admin"],
  apps: ["records", "billing"],
};

const api: AuthApi = {
  user: MOCK_USER,
  isLoading: false,
  getToken: async () => "mock-token",
  logout: () => window.location.reload(),
};

const MockAuthContext = createContext<AuthApi>(api);

export function MockAuthProvider({ children }: { children: ReactNode }) {
  return <MockAuthContext.Provider value={api}>{children}</MockAuthContext.Provider>;
}

export function useMockAuth(): AuthApi {
  return useContext(MockAuthContext);
}
