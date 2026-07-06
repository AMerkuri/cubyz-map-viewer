import { lazy, Suspense } from "react";
import type { MapDebugSettings } from "../../../lib/world-view-debug.js";
import type { LayerVisibility } from "../../../types/world-view.js";

const MapDebugParameters = lazy(async () =>
  import("../../world-view/components/MapDebugParameters.js").then(
    ({ MapDebugParameters }) => ({ default: MapDebugParameters }),
  ),
);

interface DebugParametersContentProps {
  mapDebugSettings: MapDebugSettings;
  setMapDebugSettings: (next: MapDebugSettings) => void;
  renderDistance: number;
  setRenderDistance: (value: number) => void;
  voxelLod1MaxDist: number;
  setVoxelLod1MaxDist: (value: number) => void;
  minRenderedVoxelLod: number;
  setMinRenderedVoxelLod: (value: number) => void;
  layerVisibility: LayerVisibility;
  setChunkBorders: (active: boolean) => void;
  setVoxelHeightLabels: (active: boolean) => void;
}

export function DebugParametersContent({
  mapDebugSettings,
  setMapDebugSettings,
  renderDistance,
  setRenderDistance,
  voxelLod1MaxDist,
  setVoxelLod1MaxDist,
  minRenderedVoxelLod,
  setMinRenderedVoxelLod,
  layerVisibility,
  setChunkBorders,
  setVoxelHeightLabels,
}: DebugParametersContentProps) {
  return (
    <Suspense fallback={<div>Loading parameters...</div>}>
      <MapDebugParameters
        settings={mapDebugSettings}
        onChange={setMapDebugSettings}
        renderDistance={renderDistance}
        onRenderDistanceChange={setRenderDistance}
        voxelLod1MaxDist={voxelLod1MaxDist}
        onVoxelLod1MaxDistChange={setVoxelLod1MaxDist}
        minRenderedVoxelLod={minRenderedVoxelLod}
        onMinRenderedVoxelLodChange={setMinRenderedVoxelLod}
        chunkBorders={layerVisibility.chunkBorders}
        voxelHeights={layerVisibility.voxelHeightLabels}
        onChunkBordersChange={setChunkBorders}
        onVoxelHeightsChange={setVoxelHeightLabels}
      />
    </Suspense>
  );
}
