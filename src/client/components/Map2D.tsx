import { useEffect, useRef, useCallback, useMemo } from "react";
import L from "leaflet";
import type { useWorldData } from "../hooks/useWorldData.js";
import type { PlayerData } from "../hooks/usePlayers.js";
import type { WatchEvent, WatchEventType } from "../hooks/useWebSocket.js";

/**
 * Leaflet 2D map for Cubyz world.
 *
 * Coordinate mapping:
 *   - Cubyz: X,Y horizontal, Z vertical (up)
 *   - Leaflet CRS: lng = worldX, lat = worldY (no y-flip)
 *   - Zoom levels:
 *       z=0  -> LOD 1  (256 blocks/tile, full detail)
 *       z=-1 -> LOD 2  (512 blocks/tile)
 *       z=-2 -> LOD 4  (1024 blocks/tile)
 *       z=-3 -> LOD 8  (2048 blocks/tile)
 *       z=-4 -> LOD 16 (4096 blocks/tile)
 *       z=-5 -> LOD 32 (8192 blocks/tile)
 *   - Each surface file maps 1:1 to one Leaflet tile at its native zoom.
 */

interface Map2DProps {
  worldData: ReturnType<typeof useWorldData>;
  players: PlayerData[];
  onCursorMove: (pos: [number, number] | null) => void;
  subscribe: (type: WatchEventType, handler: (event: WatchEvent) => void) => () => void;
}

// Custom CRS: like CRS.Simple but no y-axis flip.
// transformation(a, b, c, d): pixel_x = a*lng + b, pixel_y = c*lat + d
// Standard CRS.Simple uses (1, 0, -1, 0) which flips Y.
// We use (1, 0, 1, 0) so worldY maps directly to pixel-Y (down on screen).
const CubyzCRS = L.Util.extend({}, L.CRS.Simple, {
  transformation: new L.Transformation(1, 0, 1, 0),
});

export function Map2D({ worldData, players, onCursorMove, subscribe }: Map2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const biomeLayerRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const initializedRef = useRef(false);

  const spawnCenter = useMemo(() => {
    if (!worldData.worldData) return null;
    const [sx, sy] = worldData.worldData.spawn;
    // lat = worldY, lng = worldX
    return L.latLng(sy, sx);
  }, [worldData.worldData]);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      crs: CubyzCRS,
      center: L.latLng(0, 0), // Will be updated when world data loads
      zoom: 0,
      minZoom: -5,
      maxZoom: 2,
      zoomControl: true,
      attributionControl: false,
      zoomSnap: 1,
    });

    // Custom tile layer that maps zoom levels to LOD surface files
    const CubyzTileLayer = L.TileLayer.extend({
      getTileUrl: function (coords: L.Coords) {
        // Clamp to native zoom range
        const z = Math.max(-5, Math.min(0, coords.z));
        const lod = Math.pow(2, -z);
        // Tile coords map directly to API tile indices at native zoom
        return `/api/tiles/${lod}/${coords.x}/${coords.y}.png`;
      },
    });

    const tileLayer = new (CubyzTileLayer as any)("", {
      tileSize: 256,
      noWrap: true,
      maxNativeZoom: 0, // LOD 1 is finest; zoom > 0 upscales
      minNativeZoom: -5, // LOD 32 is coarsest; zoom < -5 downscales
      keepBuffer: 4,
    });
    tileLayer.addTo(map);
    tileLayerRef.current = tileLayer;

    // Fallback: periodically refresh tiles in case WebSocket is disconnected
    const refreshInterval = setInterval(() => {
      tileLayer.redraw();
    }, 30000);

    // Coordinate display on mouse move
    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      // lng = worldX, lat = worldY
      onCursorMove([Math.round(e.latlng.lng), Math.round(e.latlng.lat)]);
    });
    map.on("mouseout", () => onCursorMove(null));

    // Marker layer
    const markers = L.layerGroup().addTo(map);
    markersRef.current = markers;

    // Biome label layer
    const biomeLayer = L.layerGroup().addTo(map);
    biomeLayerRef.current = biomeLayer;

    mapRef.current = map;

    return () => {
      clearInterval(refreshInterval);
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
      biomeLayerRef.current = null;
      tileLayerRef.current = null;
      initializedRef.current = false;
    };
  }, [onCursorMove]);

  // Subscribe to WebSocket tile-updated events for instant refresh
  useEffect(() => {
    const unsub = subscribe("tile-updated", () => {
      // Redraw all tiles when any tile changes
      tileLayerRef.current?.redraw();
    });
    return unsub;
  }, [subscribe]);

  // Subscribe to surface-index-changed for biome label refresh
  useEffect(() => {
    const unsub = subscribe("surface-index-changed", () => {
      // Refresh biome labels when new surface files appear
      if (mapRef.current) {
        loadBiomeLabels(mapRef.current, biomeLayerRef.current);
      }
    });
    return unsub;
  }, [subscribe]);

  // Center on spawn when world data loads
  useEffect(() => {
    if (!mapRef.current || !spawnCenter || initializedRef.current) return;
    mapRef.current.setView(spawnCenter, 0);
    initializedRef.current = true;
  }, [spawnCenter]);

  // Update markers when world data or players change
  useEffect(() => {
    if (!markersRef.current || !worldData.worldData) return;

    const markers = markersRef.current;
    markers.clearLayers();

    // Spawn marker (red circle with glow)
    const spawn = worldData.worldData.spawn;
    const spawnPos = L.latLng(spawn[1], spawn[0]); // lat=Y, lng=X
    const spawnIcon = L.divIcon({
      className: "",
      html: `<div style="
        width: 20px; height: 20px;
        background: #ff4444;
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 0 10px rgba(255,68,68,0.8), 0 0 20px rgba(255,68,68,0.3);
        transform: translate(-10px, -10px);
      "></div>`,
      iconSize: [0, 0],
    });
    L.marker(spawnPos, { icon: spawnIcon })
      .bindTooltip(
        `<b>Spawn</b><br>${spawn[0]}, ${spawn[1]}, ${spawn[2]}`,
        { direction: "top", offset: [0, -14] }
      )
      .addTo(markers);

    // Player markers (blue circles)
    for (const player of players) {
      const pos = L.latLng(player.position[1], player.position[0]);
      const name = cleanPlayerName(player.name);
      const playerIcon = L.divIcon({
        className: "",
        html: `<div style="
          width: 14px; height: 14px;
          background: #44aaff;
          border: 2px solid white;
          border-radius: 50%;
          box-shadow: 0 0 8px rgba(68,170,255,0.6);
          transform: translate(-7px, -7px);
        "></div>`,
        iconSize: [0, 0],
      });
      L.marker(pos, { icon: playerIcon })
        .bindTooltip(
          `<b>${name}</b><br>${Math.round(player.position[0])}, ${Math.round(player.position[1])}, ${Math.round(player.position[2])}`,
          { direction: "top", offset: [0, -10] }
        )
        .addTo(markers);
    }
  }, [worldData.worldData, players]);

  // Load biome labels when map is ready and surface index is available
  useEffect(() => {
    if (!mapRef.current || !biomeLayerRef.current) return;
    if (worldData.surfaceIndex.length === 0) return;

    loadBiomeLabels(mapRef.current, biomeLayerRef.current);

    // Also reload biome labels when zoom changes (show/hide based on zoom)
    const map = mapRef.current;
    const biomeLayer = biomeLayerRef.current;

    function onZoomEnd() {
      if (!map) return;
      const zoom = map.getZoom();
      // Show biome labels only at zoom >= -1 (LOD 1 and 2)
      if (zoom >= -1) {
        if (!map.hasLayer(biomeLayer)) {
          map.addLayer(biomeLayer);
        }
      } else {
        if (map.hasLayer(biomeLayer)) {
          map.removeLayer(biomeLayer);
        }
      }
    }
    map.on("zoomend", onZoomEnd);
    // Run once to set initial visibility
    onZoomEnd();

    return () => {
      map.off("zoomend", onZoomEnd);
    };
  }, [worldData.surfaceIndex]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        background: "#1a1a2e",
      }}
    />
  );
}

/** Fetch biome region data from the API and add labels to the biome layer */
async function loadBiomeLabels(
  map: L.Map,
  biomeLayer: L.LayerGroup | null
): Promise<void> {
  if (!biomeLayer) return;
  biomeLayer.clearLayers();

  try {
    // Fetch the surface index to know which tiles exist at LOD 1
    const indexRes = await fetch("/api/world/surface-index");
    if (!indexRes.ok) return;
    const index: { lod: number; tileX: number; tileY: number }[] = await indexRes.json();
    const lod1Tiles = index.filter((e) => e.lod === 1);

    // Fetch biome data for each LOD 1 tile (limit to avoid overload)
    const tilesToLoad = lod1Tiles.slice(0, 16);
    const results = await Promise.all(
      tilesToLoad.map(async (tile) => {
        const res = await fetch(`/api/biomes/1/${tile.tileX}/${tile.tileY}`);
        if (!res.ok) return null;
        return res.json();
      })
    );

    for (const data of results) {
      if (!data || !data.regions) continue;

      for (const region of data.regions) {
        // region: { biomeId, biomeName, centerX, centerY, count }
        // Only show biomes that cover a meaningful area (at least 256 cells = ~0.4% of tile)
        if (region.count < 256) continue;

        const pos = L.latLng(region.centerY, region.centerX);
        const displayName = formatBiomeName(region.biomeName);

        const biomeIcon = L.divIcon({
          className: "",
          html: `<div style="
            white-space: nowrap;
            font-size: 11px;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.7);
            text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.5);
            pointer-events: none;
            transform: translate(-50%, -50%);
          ">${displayName}</div>`,
          iconSize: [0, 0],
        });

        L.marker(pos, {
          icon: biomeIcon,
          interactive: false,
        }).addTo(biomeLayer);
      }
    }
  } catch (e) {
    console.warn("Failed to load biome labels:", e);
  }
}

/** Format a biome ID like "cubyz:plains/dry" into "Dry Plains" */
function formatBiomeName(biomeId: string): string {
  // Strip mod prefix
  const name = biomeId.includes(":") ? biomeId.split(":")[1] : biomeId;
  // Split on / and _ to get parts
  const parts = name.split(/[/_]/).filter(Boolean);
  // Capitalize each part
  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .reverse() // "plains/dry" -> "Dry Plains"
    .join(" ");
}

function cleanPlayerName(name: string): string {
  return name.replace(/\*{1,3}|#[0-9A-Fa-f]{6}/g, "").trim() || "Player";
}
