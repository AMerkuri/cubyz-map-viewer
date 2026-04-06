import { useState, useEffect, useCallback } from "react";

export interface PlayerData {
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  gamemode: string;
  health: number;
  energy: number;
  spawnPos: [number, number, number];
}

export function usePlayers() {
  const [data, setData] = useState<PlayerData[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/players");
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      // Players are non-critical, ignore errors
    }
  }, []);

  useEffect(() => {
    refresh();
    // Poll every 30 seconds as a fallback (WebSocket handles fast updates)
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { data, refresh };
}
