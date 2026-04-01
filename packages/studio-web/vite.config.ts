import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/studio/",
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://127.0.0.1:4312",
        ws: true,
      },
      "/api": {
        target: "http://127.0.0.1:4312",
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
