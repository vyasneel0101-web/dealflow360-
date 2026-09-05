import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * Two entry points, one build. The internal app and the customer portal are
 * separate bundles by design - internal code is never shipped to a customer's
 * browser (TRD.md section 2). This is the build-level half of that guarantee;
 * the auth-level half is the two session realms.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "shared"),
      "@ui": resolve(__dirname, "web/src/ui"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        web: resolve(__dirname, "web/index.html"),
        portal: resolve(__dirname, "portal/index.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Everything under /api goes to Express. No CORS, no CDN, no external
      // hosts - the app runs with the network cable out (offline criterion).
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
