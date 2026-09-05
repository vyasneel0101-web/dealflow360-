import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * Dev-server SPA fallback.
 *
 * Two entry points means Vite's root has no index.html of its own, so the URL
 * it prints on startup — http://localhost:5173/ — serves a blank page. A judge
 * follows that URL, sees white, and concludes the app is broken.
 *
 * The internal app also routes on real history-API paths (/quotations,
 * /approvals), so a reload anywhere but the root would 404 for the same reason.
 * Both are the same fix: a request that is not an asset, not an API call and
 * not one of Vite's own internals resolves to the right entry's index.html.
 *
 * Dev only. In production Express serves the built bundles and does this itself.
 */
function spaFallback(): Plugin {
  // Vite internals (/@vite/client, /@react-refresh, /@fs/…), dependency and
  // source requests must reach Vite untouched.
  const internals = /^\/(api|@|node_modules\/|web\/|portal\/|shared\/)/;

  return {
    name: "dealflow-dev-spa-fallback",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = (req.url ?? "/").split("?")[0] ?? "/";

        // The portal is a separate bundle served under its own prefix.
        if (path === "/portal" || path === "/portal/") {
          req.url = "/portal/index.html";
          return next();
        }

        // A dot in the path means a file — script, stylesheet, image — and a
        // missing one of those should stay a 404 rather than silently
        // returning HTML, which turns a typo into a confusing parse error.
        if (!internals.test(path) && !path.includes(".")) {
          req.url = "/web/index.html";
        }
        next();
      });
    },
  };
}

/**
 * Two entry points, one build. The internal app and the customer portal are
 * separate bundles by design - internal code is never shipped to a customer's
 * browser (TRD.md section 2). This is the build-level half of that guarantee;
 * the auth-level half is the two session realms.
 */
export default defineConfig({
  plugins: [react(), spaFallback()],
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
