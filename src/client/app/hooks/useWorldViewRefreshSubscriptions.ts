import { useEffect } from "react";
import type {
  TerrainUpdatesBatchEvent,
  useWebSocket,
} from "../../features/world-view/hooks/useWebSocket.js";
import type { useWorldData } from "../../features/world-view/hooks/useWorldData.js";

export function useWorldViewRefreshSubscriptions(args: {
  chunkIndexEnabled: boolean;
  subscribe: ReturnType<typeof useWebSocket>["subscribe"];
  worldData: ReturnType<typeof useWorldData>;
}) {
  const { chunkIndexEnabled, subscribe, worldData } = args;

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(
      subscribe("world-updated", () => {
        worldData.refresh();
      }),
    );

    unsubs.push(
      subscribe("surface-index-changed", () => {
        worldData.refreshSurfaceIndex();
        if (chunkIndexEnabled) {
          worldData.refreshChunkIndex();
        }
      }),
    );

    unsubs.push(
      subscribe("terrain-updates-batch", (event) => {
        const batch = event as TerrainUpdatesBatchEvent;
        if (batch.data.tiles.length > 0) {
          worldData.refreshSurfaceIndex();
        }
        if (batch.data.regions.length > 0 && chunkIndexEnabled) {
          worldData.refreshChunkIndex();
        }
      }),
    );

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [
    chunkIndexEnabled,
    subscribe,
    worldData.refresh,
    worldData.refreshChunkIndex,
    worldData.refreshSurfaceIndex,
  ]);
}
