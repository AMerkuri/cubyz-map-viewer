import { useCallback, useEffect, useRef, useState } from "react";

export type WatchEventType =
  | "players-updated"
  | "world-updated"
  | "surface-index-changed"
  | "terrain-updates-batch";

interface TerrainTileUpdate {
  lod: number;
  tileX: number;
  tileY: number;
}

interface TerrainRegionUpdate {
  lod: number;
  regionX: number;
  regionY: number;
}

export interface WatchEvent {
  type: WatchEventType;
  data?: Record<string, unknown>;
  sentAt?: number;
}

export interface TerrainUpdatesBatchEvent {
  type: "terrain-updates-batch";
  data: {
    tiles: TerrainTileUpdate[];
    regions: TerrainRegionUpdate[];
  };
  sentAt?: number;
}

type EventHandler = (event: WatchEvent | TerrainUpdatesBatchEvent) => void;

/**
 * Hook that maintains a WebSocket connection to the server for real-time
 * file change notifications. Automatically reconnects on disconnection.
 *
 * Returns:
 *   - subscribe: register a handler for a specific event type
 */
export function useWebSocket() {
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<WatchEventType, Set<EventHandler>>>(new Map());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const subscribe = useCallback(
    (eventType: WatchEventType, handler: EventHandler) => {
      if (!handlersRef.current.has(eventType)) {
        handlersRef.current.set(eventType, new Set());
      }
      handlersRef.current.get(eventType)?.add(handler);

      // Return unsubscribe function
      return () => {
        handlersRef.current.get(eventType)?.delete(handler);
      };
    },
    [],
  );

  useEffect(() => {
    let disposed = false;

    function connect() {
      if (disposed) return;

      // Build WebSocket URL from current page location
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}/ws`;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }
      };

      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as
            | WatchEvent
            | TerrainUpdatesBatchEvent;
          setLastUpdateAt(event.sentAt ?? Date.now());
          const handlers = handlersRef.current.get(event.type);
          if (handlers) {
            for (const handler of handlers) {
              handler(event);
            }
          }
        } catch {}
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!disposed) {
          // Reconnect after a delay
          reconnectTimerRef.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror, triggering reconnect
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return { lastUpdateAt, subscribe };
}
