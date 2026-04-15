import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { WatchEvent, WatchEventType } from "./useWebSocket.js";

const PLAYERS_STALE_AFTER_MS = 30_000;

export interface PlayerData {
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
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

export function usePlayers(
  subscribe?: (
    type: WatchEventType,
    handler: (event: WatchEvent) => void,
  ) => () => void,
) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["players"],
    queryFn: fetchPlayers,
    staleTime: PLAYERS_STALE_AFTER_MS,
    refetchInterval: PLAYERS_STALE_AFTER_MS,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!subscribe) return;
    return subscribe("players-updated", () => {
      void queryClient.invalidateQueries({ queryKey: ["players"] });
    });
  }, [subscribe, queryClient]);

  return { data: query.data ?? [] };
}
