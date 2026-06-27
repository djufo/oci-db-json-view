import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
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
  }
});
