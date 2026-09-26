import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  plugins: [
    {
      // Import .geojson files as JSON, like next.config.ts does.
      name: "geojson",
      transform(code, id) {
        if (id.endsWith(".geojson")) return { code: `export default ${code};`, map: null };
      },
    },
  ],
  test: { environment: "node" },
});
