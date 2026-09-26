import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep next dev from rewriting our AGENTS.md.
  agentRules: false,
  // Dev-only badge; keep it off the mascot in the bottom-left.
  devIndicators: { position: "bottom-right" },
  turbopack: {
    // Import .geojson files as JSON.
    rules: {
      "*.geojson": { loaders: ["./geojson-loader.cjs"], as: "*.js" },
    },
  },
};

export default nextConfig;
