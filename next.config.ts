import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite locates its WASM files relative to its own module; bundling breaks that.
  // `ws` (used by the Neon driver) crashes with "b.mask is not a function" when webpack bundles it.
  serverExternalPackages: ["@electric-sql/pglite", "ws", "bufferutil", "utf-8-validate"],
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*"] },
};

export default nextConfig;
