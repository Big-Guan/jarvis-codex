import { defineConfig } from "vite";
export default defineConfig({
  clearScreen: false,
  server: { host: "127.0.0.1", port: 4400, strictPort: true },
  worker: { format: "es" },
  build: { chunkSizeWarningLimit: 1800 },
});
