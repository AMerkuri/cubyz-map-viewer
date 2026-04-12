import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function selectVoxelAcceptEncoding(
  acceptEncoding: string | string[] | undefined,
): string | null {
  const raw = Array.isArray(acceptEncoding)
    ? acceptEncoding.join(",")
    : acceptEncoding;
  if (!raw) {
    return null;
  }

  const encodings: Array<{
    token: "br" | "gzip";
    quality: number;
    order: number;
  }> = [];
  for (const [order, entry] of raw.split(",").entries()) {
    const [token, ...params] = entry
      .trim()
      .toLowerCase()
      .split(";")
      .map((part) => part.trim());
    if (token !== "br" && token !== "gzip") {
      continue;
    }

    let quality = 1;
    for (const param of params) {
      const [name, rawValue] = param.split("=").map((part) => part.trim());
      if (name !== "q" || !rawValue) {
        continue;
      }
      const parsed = Number(rawValue);
      quality = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
    }
    if (quality <= 0) {
      continue;
    }

    encodings.push({
      token,
      quality,
      order,
    });
  }

  if (encodings.length === 0) {
    return null;
  }

  encodings.sort(
    (left, right) => right.quality - left.quality || left.order - right.order,
  );

  return encodings
    .map(({ token, quality }) =>
      quality === 1 ? token : `${token};q=${quality.toFixed(3)}`,
    )
    .join(", ");
}

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
      "/api/voxels": {
        target: "http://localhost:3001",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            const acceptEncoding = selectVoxelAcceptEncoding(
              req.headers["accept-encoding"],
            );
            if (acceptEncoding) {
              proxyReq.setHeader("Accept-Encoding", acceptEncoding);
              return;
            }
            proxyReq.removeHeader("Accept-Encoding");
          });
        },
      },
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
