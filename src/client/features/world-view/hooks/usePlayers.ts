import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export interface PlayerData {
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  gamemode: string;
  health: number;
  energy: number;
  spawnPos: [number, number, number];
  lastSeen: number;
  isActive: boolean;
}

async function fetchPlayers(): Promise<PlayerData[]> {
  const res = await fetch("/api/players");
  if (!res.ok) return [];
  return res.json();
}

export function usePlayers() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["players"],
    queryFn: fetchPlayers,
    // Poll every 30 seconds as a fallback (WebSocket handles fast updates)
    refetchInterval: 30000,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["players"] });
  }, [queryClient]);

  return { data: query.data ?? [], refresh };
}
