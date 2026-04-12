import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist/client",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/three/examples/") ||
            id.includes("node_modules/three/addons/")
          ) {
            return "vendor-three-addons";
          }

          if (id.includes("node_modules/three/")) {
            return "vendor-three";
          }

          if (id.includes("node_modules/@tanstack/react-query/")) {
            return "vendor-react-query";
          }
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
