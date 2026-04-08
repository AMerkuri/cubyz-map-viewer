import { useEffect, useRef, useCallback, useMemo } from "react";
import L from "leaflet";
import type { useWorldData } from "../hooks/useWorldData.js";
import type { PlayerData } from "../hooks/usePlayers.js";
import type { TerrainUpdatesBatchEvent, WatchEvent, WatchEventType } from "../hooks/useWebSocket.js";

/**
 * Leaflet 2D map for Cubyz world.
 *
 * Coordinate mapping:
 *   - Cubyz: X,Y horizontal, Z vertical (up)
 *   - Leaflet CRS: lng = worldX, lat = worldY (no y-flip)
 *   - Zoom levels (Leaflet uses non-negative integers to avoid tile-layer bugs):
 *       z=5  -> LOD 1  (256 blocks/tile, full detail)   [native]
 *       z=4  -> LOD 2  (512 blocks/tile)                [native]
 *       z=3  -> LOD 4  (1024 blocks/tile)               [native]
 *       z=2  -> LOD 8  (2048 blocks/tile)               [native]
 *       z=1  -> LOD 16 (4096 blocks/tile)               [native]
 *       z=0  -> LOD 32 (8192 blocks/tile)               [native]
 *       z=6  -> LOD 1 upscaled 2×
 *       z=7  -> LOD 1 upscaled 4×
 *   - CRS transform scale 1/32 compensates for the zoom shift so that
 *     world coordinates map to the same pixel positions as before.
 */

/** Leaflet zoom level that corresponds to LOD 1 (1 pixel per block). */
const ZOOM_LOD1 = 5;

/** Maximum number of biome labels to display at once. Prioritizes labels near screen center. */
const MAX_BIOME_LABELS = 50;

interface Map2DProps {
  worldData: ReturnType<typeof useWorldData>;
  players: PlayerData[];
  onCursorMove: (pos: [number, number, number] | null) => void;
  subscribe: (type: WatchEventType, handler: (event: WatchEvent) => void) => () => void;
  showBiomeLabels: boolean;
  showPlayers: boolean;
  showSpawn: boolean;
  initialViewState: { center: [number, number]; zoom: number } | null;
  onShareStateChange: (state: { mode: "2d"; center: [number, number]; zoom: number }) => void;
  flyToRequest: { pos: [number, number, number]; key: number } | null;
}

// Custom CRS: like CRS.Simple but no y-axis flip.
// transformation(a, b, c, d): pixel_x = a*lng + b, pixel_y = c*lat + d
// Standard CRS.Simple uses (1, 0, -1, 0) which flips Y.
// Scale factor 1/32 (= 1/2^ZOOM_LOD1) compensates for shifting zoom levels
// up by ZOOM_LOD1 so that all Leaflet zoom values stay non-negative, avoiding
// Leaflet's broken tile-rendering path for negative zoom integers.
const CubyzCRS = L.Util.extend({}, L.CRS.Simple, {
  transformation: new L.Transformation(1 / 32, 0, 1 / 32, 0),
});

export function Map2D({ worldData, players, onCursorMove, subscribe, showBiomeLabels, showPlayers, showSpawn, initialViewState, onShareStateChange, flyToRequest }: Map2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const spawnLayerRef = useRef<L.LayerGroup | null>(null);
  const playersLayerRef = useRef<L.LayerGroup | null>(null);
  const biomeLayerRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const initializedRef = useRef(false);
  const onShareStateChangeRef = useRef(onShareStateChange);
  onShareStateChangeRef.current = onShareStateChange;

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
      zoom: ZOOM_LOD1,
      minZoom: 0,
      maxZoom: ZOOM_LOD1 + 2, // allow 4× upscale beyond LOD 1
      zoomControl: true,
      attributionControl: false,
      zoomSnap: 1,
    });

    // Custom tile layer that maps Leaflet zoom levels to LOD surface files.
    // coords.z is always a non-negative integer here (Leaflet is broken for
    // negative zoom values with tile layers).
    const CubyzTileLayer = L.TileLayer.extend({
      getTileUrl: function (coords: L.Coords) {
        // ZOOM_LOD1 = LOD 1; each step down doubles the LOD.
        const lod = Math.pow(2, Math.max(0, ZOOM_LOD1 - coords.z));
        return `/api/tiles/${lod}/${coords.x}/${coords.y}.png`;
      },
    });

    const tileLayer = new (CubyzTileLayer as any)("", {
      tileSize: 256,
      noWrap: true,
      maxNativeZoom: ZOOM_LOD1,  // LOD 1 is finest; zoom above upscales
      minNativeZoom: 0,           // LOD 32 is coarsest; zoom below downscales
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
      onCursorMove([Math.round(e.latlng.lng), Math.round(e.latlng.lat), 0]);
    });
    map.on("mouseout", () => onCursorMove(null));

    function reportShareState() {
      onShareStateChangeRef.current({
        mode: "2d",
        center: [map.getCenter().lng, map.getCenter().lat],
        zoom: map.getZoom(),
      });
    }

    map.on("moveend", reportShareState);
    map.on("zoomend", reportShareState);

    // Marker layers (spawn and players kept separate for independent toggling)
    const spawnLayer = L.layerGroup().addTo(map);
    spawnLayerRef.current = spawnLayer;

    const playersLayer = L.layerGroup().addTo(map);
    playersLayerRef.current = playersLayer;

    // Biome label layer
    const biomeLayer = L.layerGroup().addTo(map);
    biomeLayerRef.current = biomeLayer;

    mapRef.current = map;

    return () => {
      clearInterval(refreshInterval);
      map.off("moveend", reportShareState);
      map.off("zoomend", reportShareState);
      map.remove();
      mapRef.current = null;
      spawnLayerRef.current = null;
      playersLayerRef.current = null;
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

  useEffect(() => {
    const unsub = subscribe("terrain-updates-batch", (event) => {
      if (event.type !== "terrain-updates-batch") return;
      const batch = event as TerrainUpdatesBatchEvent;
      if (batch.data.tiles.length > 0) {
        tileLayerRef.current?.redraw();
      }
    });
    return unsub;
  }, [subscribe]);

  // Subscribe to surface-index-changed for biome label refresh
  useEffect(() => {
    const unsub = subscribe("surface-index-changed", () => {
      // Trigger biome labels update when surface index changes
      // This will be handled by the main biome labels effect
    });
    return unsub;
  }, [subscribe]);

  // Center on spawn when world data loads
  useEffect(() => {
    if (!mapRef.current || !spawnCenter || initializedRef.current) return;
    const map = mapRef.current;
    if (initialViewState) {
      map.setView(L.latLng(initialViewState.center[1], initialViewState.center[0]), initialViewState.zoom);
    } else {
      map.setView(spawnCenter, ZOOM_LOD1);
    }
    initializedRef.current = true;
    onShareStateChangeRef.current({
      mode: "2d",
      center: [map.getCenter().lng, map.getCenter().lat],
      zoom: map.getZoom(),
    });
  }, [spawnCenter]);

  // Update markers when world data or players change
  useEffect(() => {
    if (!spawnLayerRef.current || !playersLayerRef.current || !worldData.worldData) return;

    spawnLayerRef.current.clearLayers();
    playersLayerRef.current.clearLayers();

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
      .addTo(spawnLayerRef.current);

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
        .addTo(playersLayerRef.current);
    }
  }, [worldData.worldData, players]);

  // Toggle spawn layer visibility
  useEffect(() => {
    const map = mapRef.current;
    const layer = spawnLayerRef.current;
    if (!map || !layer) return;
    if (showSpawn) {
      if (!map.hasLayer(layer)) map.addLayer(layer);
    } else {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    }
  }, [showSpawn]);

  // Toggle players layer visibility
  useEffect(() => {
    const map = mapRef.current;
    const layer = playersLayerRef.current;
    if (!map || !layer) return;
    if (showPlayers) {
      if (!map.hasLayer(layer)) map.addLayer(layer);
    } else {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    }
  }, [showPlayers]);

  // Load biome labels when map is ready and surface index is available
  useEffect(() => {
    if (!mapRef.current || !biomeLayerRef.current) return;
    if (worldData.surfaceIndex.length === 0) return;

    const map = mapRef.current;
    const biomeLayer = biomeLayerRef.current;
    let loadingTilesRef = new Set<string>();

    async function updateBiomeLabelsForViewport() {
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      // Show biome labels only at zoom >= ZOOM_LOD1 (LOD 1 only, full detail)
      const wantVisible = zoom >= ZOOM_LOD1 - 3;

      if (!wantVisible) {
        biomeLayer.clearLayers();
        if (map.hasLayer(biomeLayer)) map.removeLayer(biomeLayer);
        return;
      }

      if (!map.hasLayer(biomeLayer)) map.addLayer(biomeLayer);

      // Calculate which LOD-1 tiles are visible in the current viewport
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const minX = Math.floor(Math.min(sw.lng, ne.lng) / 256);
      const maxX = Math.floor(Math.max(sw.lng, ne.lng) / 256);
      const minY = Math.floor(Math.min(sw.lat, ne.lat) / 256);
      const maxY = Math.floor(Math.max(sw.lat, ne.lat) / 256);

      // Collect all visible LOD-1 tiles
      const visibleTiles: { tileX: number; tileY: number }[] = [];
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          visibleTiles.push({ tileX: x, tileY: y });
        }
      }

      // Collect all biome regions from visible tiles before rendering
      interface BiomeLabel {
        pos: L.LatLng;
        displayName: string;
        distanceToCenter: number;
      }
      const allLabels: BiomeLabel[] = [];

      // Load biome data for visible tiles (that aren't already loading)
      const loadPromises: Promise<void>[] = [];
      for (const tile of visibleTiles) {
        const key = `${tile.tileX}/${tile.tileY}`;
        if (loadingTilesRef.has(key)) continue;
        loadingTilesRef.add(key);

        const promise = (async () => {
          try {
            const res = await fetch(`/api/biomes/1/${tile.tileX}/${tile.tileY}`);
            if (!res.ok) return;
            const data = await res.json();

            if (!data || !data.regions) return;

            for (const region of data.regions) {
              if (region.count < 256) continue;

              const pos = L.latLng(region.centerY, region.centerX);
              const displayName = formatBiomeName(region.biomeName);

              allLabels.push({
                pos,
                displayName,
                distanceToCenter: 0, // will be calculated after all labels are collected
              });
            }
          } catch (e) {
            console.warn(`Failed to load biome labels for tile ${key}:`, e);
          } finally {
            loadingTilesRef.delete(key);
          }
        })();
        loadPromises.push(promise);
      }

      // Wait for all tiles to load, then render prioritized labels
      Promise.all(loadPromises).then(() => {
        const mapCenter = map.getCenter();

        // Calculate distance from center for each label
        for (const label of allLabels) {
          label.distanceToCenter = mapCenter.distanceTo(label.pos);
        }

        // Sort by distance (closest first)
        allLabels.sort((a, b) => a.distanceToCenter - b.distanceToCenter);

        // Clear existing layer and render only the top MAX_BIOME_LABELS
        biomeLayer.clearLayers();

        for (let i = 0; i < Math.min(allLabels.length, MAX_BIOME_LABELS); i++) {
          const label = allLabels[i];
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
            ">${label.displayName}</div>`,
            iconSize: [0, 0],
          });

          L.marker(label.pos, {
            icon: biomeIcon,
            interactive: false,
          }).addTo(biomeLayer);
        }
      });
    }

    // Initial load
    updateBiomeLabelsForViewport();

    // Update when map moves or zooms
    map.on("moveend", updateBiomeLabelsForViewport);
    map.on("zoomend", updateBiomeLabelsForViewport);

    return () => {
      map.off("moveend", updateBiomeLabelsForViewport);
      map.off("zoomend", updateBiomeLabelsForViewport);
    };
  }, [worldData.surfaceIndex]);

  // Toggle biome labels visibility (overrides zoom-based logic when hidden)
  useEffect(() => {
    const map = mapRef.current;
    const layer = biomeLayerRef.current;
    if (!map || !layer) return;
    if (!showBiomeLabels) {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    } else {
      // Re-apply zoom check: only show if zoom is in range (LOD 1 only)
      const zoom = map.getZoom();
      if (zoom >= ZOOM_LOD1) {
        if (!map.hasLayer(layer)) map.addLayer(layer);
      } else {
        if (map.hasLayer(layer)) map.removeLayer(layer);
      }
    }
  }, [showBiomeLabels]);

  // Fly to player position on request
  useEffect(() => {
    if (!flyToRequest || !mapRef.current) return;
    const [wx, wy] = flyToRequest.pos;
    // Leaflet CRS: lat = worldY, lng = worldX; fly at LOD 1 zoom for detail
    mapRef.current.flyTo(L.latLng(wy, wx), ZOOM_LOD1, { animate: true, duration: 0.6 });
  }, [flyToRequest]);

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
