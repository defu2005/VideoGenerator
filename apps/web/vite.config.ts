import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      // Fixed port: if 5173 is taken, fail loudly instead of moving to 5174,
      // whose origin the auth server does not trust (login would always fail).
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: process.env.VITE_API_PROXY_TARGET ?? env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:3001",
          changeOrigin: true,
        },
      },
    },
  };
});
