import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "web",
  plugins: [react()],
  optimizeDeps: { include: ["exifr"] },
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: { host: "127.0.0.1" },
});
