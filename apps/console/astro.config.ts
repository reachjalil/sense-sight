import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  server: { port: 4325 },
  integrations: [react()],
  devToolbar: { enabled: false },
  vite: { cacheDir: "../../node_modules/.vite/sense-sight-console" },
});
