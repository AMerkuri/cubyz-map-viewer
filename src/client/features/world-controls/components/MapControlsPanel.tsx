import { OverlayPanel } from "../../../components/OverlayPanel.js";
import type { GraphicsPreset } from "../../../lib/world-view-graphics-presets.js";
import type {
  LayerVisibility,
  WorldViewMode,
} from "../../../types/world-view.js";
import { MapControlsContent } from "./MapControlsContent.js";

interface MapControlsPanelProps {
  view: WorldViewMode;
  activeGraphicsPresetId: string | null;
  applyGraphicsPreset: (preset: GraphicsPreset) => void;
  layerVisibility: LayerVisibility;
  handleLayerVisibilityChange: (visibility: LayerVisibility) => void;
}

export function MapControlsPanel({
  view,
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
        view={view}
        activeGraphicsPresetId={activeGraphicsPresetId}
        applyGraphicsPreset={applyGraphicsPreset}
        layerVisibility={layerVisibility}
        handleLayerVisibilityChange={handleLayerVisibilityChange}
      />
    </OverlayPanel>
  );
}
