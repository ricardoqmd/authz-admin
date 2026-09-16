import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  /*
   * Self-contained server bundle in .next/standalone: Next traces the modules
   * the server actually reaches and copies those, so the runtime image carries
   * a fraction of node_modules and needs no package manager to start. The
   * Dockerfile depends on this; see docs/deployment.md.
   */
  output: "standalone",
};

export default withNextIntl(nextConfig);
