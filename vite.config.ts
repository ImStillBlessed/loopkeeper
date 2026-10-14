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
  },
  build: { outDir: "dist", emptyOutDir: true },
});
