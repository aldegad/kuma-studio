import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const KUMA_PORT = Number(env.VITE_KUMA_PORT) || 4312;

  return {
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
        "/studio/memo-images": {
          target: `http://127.0.0.1:${KUMA_PORT}`,
        },
        "/ws": {
          target: `ws://127.0.0.1:${KUMA_PORT}`,
          ws: true,
        },
        "/api": {
          target: `http://127.0.0.1:${KUMA_PORT}`,
        },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
