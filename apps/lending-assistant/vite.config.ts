import { defineConfig } from "vite";

export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  publicDir: "public",
  build: {
    outDir: "../../dist/lending-assistant",
    emptyOutDir: true
  },
  server: {
    host: "0.0.0.0",
    port: 5173
  }
});