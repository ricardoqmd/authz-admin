/*
 * Layer boundaries, enforced in CI (`pnpm boundaries`) — same rules as the
 * department's nami-frontend, adapted to the PAP:
 *
 *   app/     → may import modules/, lib/, ui/, i18n/
 *   modules/ → may import lib/, ui/  (never app/)
 *   ui/      → imports nothing from modules/, lib/, app/
 *   lib/     → imports nothing from ui/, modules/, app/
 *   Nobody imports @ricardoqmd/auth-* outside lib/auth (the facade rule).
 */
module.exports = {
  forbidden: [
    {
      name: "modules-not-from-app",
      severity: "error",
      from: { path: "^src/modules" },
      to: { path: "^src/app" },
    },
    {
      name: "ui-is-a-leaf",
      severity: "error",
      from: { path: "^src/ui" },
      to: { path: "^src/(modules|lib|app)" },
    },
    {
      name: "lib-does-not-know-ui",
      severity: "error",
      from: { path: "^src/lib" },
      to: { path: "^src/(ui|modules|app)" },
    },
    {
      name: "auth-library-only-behind-facade",
      severity: "error",
      from: { path: "^src", pathNot: "^src/lib/auth" },
      to: { path: "@ricardoqmd/auth" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
