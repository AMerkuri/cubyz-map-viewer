import { useState, useEffect, useCallback } from "react";

export interface WorldData {
  name: string;
  version: number;
  seed: number;
  spawn: [number, number, number];
  gameTime: number;
  doGameTimeCycle: boolean;
  tickSpeed: number;
  defaultGamemode: string;
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

export function useWorldData() {
  const [worldData, setWorldData] = useState<WorldData | null>(null);
  const [surfaceIndex, setSurfaceIndex] = useState<SurfaceIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/world");
      if (res.ok) {
        setWorldData(await res.json());
      }
    } catch {
      // Non-critical on refresh, keep existing data
    }
  }, []);

  const refreshSurfaceIndex = useCallback(async () => {
    try {
      const res = await fetch("/api/world/surface-index");
      if (res.ok) {
        setSurfaceIndex(await res.json());
      }
    } catch {
      // Non-critical on refresh
    }
  }, []);

  useEffect(() => {
    async function fetchData() {
      try {
        const [worldRes, indexRes] = await Promise.all([
          fetch("/api/world"),
          fetch("/api/world/surface-index"),
        ]);

        if (!worldRes.ok) throw new Error("Failed to fetch world data");
        if (!indexRes.ok) throw new Error("Failed to fetch surface index");

        const world = await worldRes.json();
        const index = await indexRes.json();

        setWorldData(world);
        setSurfaceIndex(index);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  return { worldData, surfaceIndex, loading, error, refresh, refreshSurfaceIndex };
}
