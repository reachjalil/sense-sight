import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";

export default defineConfig({
  site: "https://sensesight.live",
  output: "server",
  adapter: cloudflare(),
  integrations: [react()],
  server: { port: 4323 },
  devToolbar: { enabled: false },
  vite: { cacheDir: "../../node_modules/.vite/sense-sight-site" },
});
