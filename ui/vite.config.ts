import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base: the UI is mounted at the root or under any sub-path by the host (specs/dbview.md).
  base: "./",
  plugins: [react()],
  server: {
    port: 6211,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:6210",
        changeOrigin: true
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    server: { deps: { inline: ["emibs-ui-lib"] } }
  }
});
