import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The dashboard lives in web/. In dev, API calls are proxied to the Hono server.
export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./web/src", import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8787" },
    // Vite answers 403 to hostnames it doesn't know. Allow tunnels (ngrok) so GitHub webhooks and
    // shared demo links reach the dev server. Add others as a comma-separated ALLOWED_HOSTS in .env.
    allowedHosts: [".ngrok-free.app", ".ngrok.app", ".ngrok.io", ...(process.env.ALLOWED_HOSTS?.split(",").map((h) => h.trim()).filter(Boolean) ?? [])],
  },
  build: { outDir: "dist", emptyOutDir: true },
});
