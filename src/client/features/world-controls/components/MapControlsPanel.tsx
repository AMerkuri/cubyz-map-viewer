import { OverlayPanel } from "../../../components/OverlayPanel.js";
import type { GraphicsPreset } from "../../../lib/world-view-graphics-presets.js";
import type { LayerVisibility } from "../../../types/world-view.js";
import { MapControlsContent } from "./MapControlsContent.js";

interface MapControlsPanelProps {
  activeGraphicsPresetId: string | null;
  applyGraphicsPreset: (preset: GraphicsPreset) => void;
  layerVisibility: LayerVisibility;
  handleLayerVisibilityChange: (visibility: LayerVisibility) => void;
}

export function MapControlsPanel({
  activeGraphicsPresetId,
  applyGraphicsPreset,
  layerVisibility,
  handleLayerVisibilityChange,
}: MapControlsPanelProps) {
  return (
    <OverlayPanel
      title="Map Controls"
      position={{ top: 12, left: 12 }}
      minWidth={250}
      maxWidth={350}
      collapsible={true}
      contentStyle={{ fontSize: 12, lineHeight: 1.25 }}
    >
      <MapControlsContent
        activeGraphicsPresetId={activeGraphicsPresetId}
        applyGraphicsPreset={applyGraphicsPreset}
        layerVisibility={layerVisibility}
        handleLayerVisibilityChange={handleLayerVisibilityChange}
      />
    </OverlayPanel>
  );
}
