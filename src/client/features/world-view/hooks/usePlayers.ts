import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useEffectEvent, useRef } from "react";

import type { WatchEvent, WatchEventType } from "./useWebSocket.js";

const PLAYERS_STALE_AFTER_MS = 30_000;

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

export function usePlayers(
  subscribe?: (
    type: WatchEventType,
    handler: (event: WatchEvent) => void,
  ) => () => void,
) {
  const queryClient = useQueryClient();
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useQuery({
    queryKey: ["players"],
    queryFn: fetchPlayers,
    staleTime: PLAYERS_STALE_AFTER_MS,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["players"] });
  }, [queryClient]);

  const scheduleSilenceRefresh = useEffectEvent(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    silenceTimerRef.current = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ["players"] });
    }, PLAYERS_STALE_AFTER_MS);
  });

  useEffect(() => {
    scheduleSilenceRefresh();
    return () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!subscribe) return;
    return subscribe("players-updated", () => {
      scheduleSilenceRefresh();
      void queryClient.invalidateQueries({ queryKey: ["players"] });
    });
  }, [subscribe, queryClient]);

  return { data: query.data ?? [], refresh };
}
