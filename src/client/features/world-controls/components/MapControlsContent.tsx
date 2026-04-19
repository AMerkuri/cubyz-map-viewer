import { uiTheme } from "../../../lib/ui-theme.js";
import {
  GRAPHICS_PRESETS,
  type GraphicsPreset,
} from "../../../lib/world-view-graphics-presets.js";
import type {
  LayerVisibility,
  WorldViewMode,
} from "../../../types/world-view.js";
import { LayerControls } from "./LayerControls.js";

interface MapControlsContentProps {
  view: WorldViewMode;
  activeGraphicsPresetId: string | null;
  applyGraphicsPreset: (preset: GraphicsPreset) => void;
  layerVisibility: LayerVisibility;
  handleLayerVisibilityChange: (visibility: LayerVisibility) => void;
  compact?: boolean;
}

function InstructionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: uiTheme.accent.text,
        fontWeight: 400,
        marginBottom: 2,
      }}
    >
      {children}
    </div>
  );
}

export function MapControlsContent({
  view,
  activeGraphicsPresetId,
  applyGraphicsPreset,
  layerVisibility,
  handleLayerVisibilityChange,
  compact = false,
}: MapControlsContentProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span
        style={{
          color: uiTheme.accent.text,
          fontWeight: 400,
        }}
      >
        Toggles
      </span>
      <LayerControls
        visibility={layerVisibility}
        onChange={handleLayerVisibilityChange}
        view={view}
        compact={compact}
      />
      {view === "voxel" && layerVisibility.debug && (
        <div style={{ display: "grid", gap: 6 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                color: uiTheme.accent.text,
                fontWeight: 400,
              }}
            >
              Graphics Presets
            </span>
            <span style={{ color: uiTheme.text.muted, fontSize: 12 }}>
              {activeGraphicsPresetId === null ? "Custom" : ""}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 6,
            }}
          >
            {GRAPHICS_PRESETS.map((preset) => {
              const active = preset.id === activeGraphicsPresetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyGraphicsPreset(preset)}
                  title={preset.description}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: compact ? "9px 10px" : "8px 10px",
                    borderRadius: 0,
                    border: active
                      ? `2px solid ${uiTheme.accent.border}`
                      : `2px solid ${uiTheme.panel.buttonBorderMuted}`,
                    background: active
                      ? uiTheme.accent.surface
                      : uiTheme.panel.buttonBackgroundMuted,
                    color: active
                      ? uiTheme.text.onAccent
                      : uiTheme.text.secondary,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 400,
                    textAlign: "left",
                    boxShadow: "2px 2px 0 rgba(0,0,0,0.5)",
                    textTransform: "uppercase",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      flexShrink: 0,
                      border: active
                        ? `2px solid ${uiTheme.accent.border}`
                        : `2px solid ${uiTheme.panel.buttonBorderMuted}`,
                      background: active
                        ? uiTheme.accent.surfaceActive
                        : uiTheme.panel.buttonBackgroundMuted,
                    }}
                  />
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.25,
          color: uiTheme.text.secondary,
          display: "grid",
          gap: compact ? 6 : 8,
        }}
      >
        {compact ? (
          <>
            <InstructionTitle>Touch</InstructionTitle>
            <div>Tap: focus point</div>
            <div>Drag: pan</div>
            <div>Pinch: zoom</div>
            <div>Two-finger drag: orbit</div>
            <div>Tap and hold: show coordinates</div>
          </>
        ) : (
          <>
            <div>
              <InstructionTitle>Mouse</InstructionTitle>
              <div>Click: focus point</div>
              <div>Left drag: pan</div>
              <div>Right drag: orbit</div>
              <div>Wheel / middle drag: zoom</div>
            </div>
            <div>
              <InstructionTitle>Keyboard</InstructionTitle>
              <div>W/A/S/D or arrows: move camera target</div>
              <div>Q / E: rotate around center</div>
              <div>Space: focus spawn</div>
            </div>
            <div>
              <InstructionTitle>Panels</InstructionTitle>
              <div>Grab a panel header to drag it around</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
