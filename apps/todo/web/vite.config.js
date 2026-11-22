import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

const apiTarget = `http://127.0.0.1:${process.env.MW_E2E_API_PORT || 4242}`;
const proxyOpts = {
  target: apiTarget,
  changeOrigin: true,
  headers: {
    origin: apiTarget,
  },
};

function normalizeDistLineEndings() {
  return {
    name: "normalize-dist-line-endings",
    closeBundle() {
      const htmlPath = path.resolve(import.meta.dirname, "dist/index.html");
      if (fs.existsSync(htmlPath)) {
        const html = fs.readFileSync(htmlPath, "utf8").replace(/\r\n/g, "\n");
        fs.writeFileSync(htmlPath, html, "utf8");
      }
    },
  };
}

// The Rust binary embeds dist/index.html, dist/assets/app.js, and dist/assets/style.css.
export default defineConfig({
  plugins: [react(), normalizeDistLineEndings()],
  build: {
    outDir: "dist",
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "assets/app.js",
        assetFileNames: (assetInfo) => {
          const names = assetInfo.names ?? (assetInfo.name ? [assetInfo.name] : []);
          if (names.some((n) => n.endsWith(".css"))) {
            return "assets/style.css";
          }
          return "assets/[name].[ext]";
        },
      },
    },
  },
  server: {
    port: Number(process.env.MW_E2E_WEB_PORT || 5173),
    proxy: {
      "/api": proxyOpts,
      "/mcp": { ...proxyOpts, ws: true },
      "/remote": proxyOpts,
      "/changelog.md": proxyOpts,
    },
  },
});
