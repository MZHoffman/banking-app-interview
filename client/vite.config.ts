import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, "../", "");
  return {
    plugins: [react()],
    server: {
      port: Number(environment.CLIENT_PORT ?? "47831"),
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://localhost:${environment.SERVER_PORT ?? "47832"}`,
          changeOrigin: false,
        },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test-setup.ts",
    },
  };
});
