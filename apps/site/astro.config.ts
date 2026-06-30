import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://sensesight.live",
  output: "static",
  server: { port: 4323 },
  devToolbar: { enabled: false },
  vite: { cacheDir: "../../node_modules/.vite/sense-sight-site" },
});
