import { request } from "node:http";

import express from "express";

import { errorHandler } from "../../../src/server/api/error-handler.js";
import { createVoxelsRouter } from "../../../src/server/api/voxels.js";
import type { VoxelMeshServiceApi } from "../../../src/server/services/voxel-mesh-service.js";

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export async function requestVoxels(
  service: VoxelMeshServiceApi,
  path: string,
  headers: Record<string, string> = {},
): Promise<HttpResponse> {
  const app = express();
  app.use("/api/voxels", createVoxelsRouter(service, "br"));
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    return await new Promise<HttpResponse>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: address.port, path, headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
