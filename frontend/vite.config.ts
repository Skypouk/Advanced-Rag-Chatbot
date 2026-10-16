import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { defineConfig, loadEnv } from "vite";

/**
 * Vite configuration.
 *
 * - PostCSS (Tailwind + Autoprefixer) is configured inline.
 * - The dev server proxies `/api` to the backend. The target comes from
 *   `VITE_PROXY_TARGET` (set to `http://backend:8000` in Docker Compose) and
 *   falls back to `http://localhost:8000` for local development.
 */
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const proxyTarget = env.VITE_PROXY_TARGET ?? "http://localhost:8000";
  const usePolling = env.CHOKIDAR_USEPOLLING === "true";

  return {
    plugins: [react()],
    css: {
      postcss: {
        plugins: [tailwindcss(), autoprefixer()],
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      watch: usePolling ? { usePolling: true, interval: 300 } : undefined,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: "0.0.0.0",
      port: 5173,
    },
  };
});
