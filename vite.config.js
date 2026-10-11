import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "web",
  plugins: [react()],
  optimizeDeps: { include: ["exifr"] },
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    fs: {
      strict: true,
      allow: ["web", "shared", "node_modules"].map((v) => path.resolve(v)),
    },
  },
});
