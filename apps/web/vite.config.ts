import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", sourcemap: false, assetsDir: "assets", assetsInlineLimit: 0 }, // CSP: font-src/img-src self, no data: URIs
  // `npm run dev -w @omnicore/web` proxies the API to a locally running server.
  server: { proxy: { "/api": "http://127.0.0.1:3000", "/health": "http://127.0.0.1:3000" } },
});
