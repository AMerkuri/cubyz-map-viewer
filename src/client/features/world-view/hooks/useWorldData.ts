import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export interface WorldData {
  name: string;
  version: number;
  seed: number;
  spawn: [number, number, number];
  allowCheats: boolean;
  lastUsedTime: number;
}

export interface SurfaceIndexEntry {
  lod: number;
  worldX: number;
  worldY: number;
  tileX: number;
  tileY: number;
}

export interface ChunkIndexEntry {
  lod: number;
  regionX: number;
  regionY: number;
}

async function fetchWorldData(): Promise<WorldData> {
  const res = await fetch("/api/world");
  if (!res.ok) throw new Error("Failed to fetch world data");
  return res.json();
}

async function fetchSurfaceIndex(): Promise<SurfaceIndexEntry[]> {
  const res = await fetch("/api/world/surface-index");
  if (!res.ok) throw new Error("Failed to fetch surface index");
  return res.json();
}

async function fetchChunkIndex(): Promise<ChunkIndexEntry[]> {
  const res = await fetch("/api/world/chunk-index");
  if (!res.ok) throw new Error("Failed to fetch chunk index");
  return res.json();
}

export function useWorldData(loadChunkIndex = true) {
  const queryClient = useQueryClient();

  const worldQuery = useQuery({
    queryKey: ["world"],
    queryFn: fetchWorldData,
  });

  const indexQuery = useQuery({
    queryKey: ["surface-index"],
    queryFn: fetchSurfaceIndex,
  });

  const chunkIndexQuery = useQuery({
    queryKey: ["chunk-index"],
    queryFn: fetchChunkIndex,
    enabled: loadChunkIndex,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["world"] });
  }, [queryClient]);

  const refreshSurfaceIndex = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["surface-index"] });
  }, [queryClient]);

  const refreshChunkIndex = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["chunk-index"] });
  }, [queryClient]);

  const loading =
    worldQuery.isLoading ||
    indexQuery.isLoading ||
    (loadChunkIndex && chunkIndexQuery.isLoading);
  const error = worldQuery.error
    ? worldQuery.error instanceof Error
      ? worldQuery.error.message
      : "Unknown error"
    : indexQuery.error
      ? indexQuery.error instanceof Error
        ? indexQuery.error.message
        : "Unknown error"
      : loadChunkIndex && chunkIndexQuery.error
        ? chunkIndexQuery.error instanceof Error
          ? chunkIndexQuery.error.message
          : "Unknown error"
        : null;

  return {
    worldData: worldQuery.data ?? null,
    surfaceIndex: indexQuery.data ?? [],
    chunkIndex: chunkIndexQuery.data ?? [],
    loading,
    error,
    refresh,
    refreshSurfaceIndex,
    refreshChunkIndex,
  };
}
