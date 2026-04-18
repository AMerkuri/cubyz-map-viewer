import { OverlayPanel } from "../../../components/OverlayPanel.js";
import { uiTheme } from "../../../lib/ui-theme.js";
import type { MapDebugSettings } from "../../../lib/world-view-debug.js";
import type {
  LayerVisibility,
  WorldViewMode,
} from "../../../types/world-view.js";
import { DebugParametersContent } from "./DebugParametersContent.js";

interface DebugParametersPanelProps {
  view: WorldViewMode;
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

export function DebugParametersPanel(props: DebugParametersPanelProps) {
  return (
    <OverlayPanel
      title="Parameters"
      position={{ top: 108, right: 12 }}
      minWidth={250}
      maxWidth={360}
      collapsible={true}
      defaultCollapsed={true}
      contentStyle={{
        fontSize: 12,
        lineHeight: 1.25,
        color: uiTheme.text.secondary,
      }}
    >
      <DebugParametersContent {...props} />
    </OverlayPanel>
  );
}
