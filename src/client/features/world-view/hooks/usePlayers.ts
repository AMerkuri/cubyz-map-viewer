import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import type { WatchEvent, WatchEventType } from "./useWebSocket.js";

const PLAYERS_STALE_AFTER_MS = 30_000;
const PLAYER_UPDATE_DEBOUNCE_MS = 300;
const PLAYERS_QUERY_KEY = ["players"] as const;

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
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playersDirtyWhileHiddenRef = useRef(false);
  const refreshQueuedAfterFetchRef = useRef(false);
  const lastProcessedPlayerEventAtRef = useRef<number>(0);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const invalidatePlayers = useCallback(() => {
    const queryState = queryClient.getQueryState(PLAYERS_QUERY_KEY);
    if (queryState?.fetchStatus === "fetching") {
      refreshQueuedAfterFetchRef.current = true;
      return;
    }

    refreshQueuedAfterFetchRef.current = false;
    void queryClient.invalidateQueries({ queryKey: PLAYERS_QUERY_KEY });
  }, [queryClient]);

  const schedulePlayersRefresh = useCallback(() => {
    clearRefreshTimer();
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      invalidatePlayers();
    }, PLAYER_UPDATE_DEBOUNCE_MS);
  }, [clearRefreshTimer, invalidatePlayers]);

  const query = useQuery({
    queryKey: PLAYERS_QUERY_KEY,
    queryFn: fetchPlayers,
    staleTime: PLAYERS_STALE_AFTER_MS,
    refetchInterval: PLAYERS_STALE_AFTER_MS,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!subscribe) return;

    function handlePlayersUpdated(event: WatchEvent) {
      const sentAt = event.sentAt ?? Date.now();
      if (sentAt <= lastProcessedPlayerEventAtRef.current) {
        return;
      }
      lastProcessedPlayerEventAtRef.current = sentAt;

      if (document.hidden) {
        playersDirtyWhileHiddenRef.current = true;
        return;
      }

      schedulePlayersRefresh();
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        return;
      }

      if (!playersDirtyWhileHiddenRef.current) {
        return;
      }

      playersDirtyWhileHiddenRef.current = false;
      schedulePlayersRefresh();
    }

    const unsubscribe = subscribe("players-updated", handlePlayersUpdated);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearRefreshTimer();
    };
  }, [clearRefreshTimer, schedulePlayersRefresh, subscribe]);

  useEffect(() => {
    if (query.fetchStatus !== "idle" || !refreshQueuedAfterFetchRef.current) {
      return;
    }

    refreshQueuedAfterFetchRef.current = false;
    schedulePlayersRefresh();
  }, [query.fetchStatus, schedulePlayersRefresh]);

  return { data: query.data ?? [] };
}
