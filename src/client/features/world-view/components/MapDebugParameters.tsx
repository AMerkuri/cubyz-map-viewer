import { useMemo, useState } from "react";
import { uiTheme } from "../../../lib/ui-theme.js";
import {
  DEFAULT_MAP_DEBUG_SETTINGS,
  MAP_DEBUG_PARAMETER_DEFINITIONS,
  type MapDebugParameterDefinition,
  type MapDebugSettings,
} from "../../../lib/world-view-debug.js";
import { LOD_LEVELS } from "../lib/constants.js";

interface MapDebugParametersProps {
  settings: MapDebugSettings;
  onChange: (next: MapDebugSettings) => void;
  renderDistance: number;
  onRenderDistanceChange: (value: number) => void;
  voxelLod1MaxDist: number;
  onVoxelLod1MaxDistChange: (value: number) => void;
  minRenderedVoxelLod: number;
  onMinRenderedVoxelLodChange: (value: number) => void;
  chunkBorders: boolean;
  voxelHeights: boolean;
  onChunkBordersChange: (active: boolean) => void;
  onVoxelHeightsChange: (active: boolean) => void;
}

const SECTION_ORDER = [
  "Atmosphere",
  "Loading",
  "LOD",
  "Focus",
  "Memory",
  "Diagnostics",
] as const;
const RESET_GLYPH_SIZE = 12;

type DebugSection = (typeof SECTION_ORDER)[number];

interface ControlSection {
  title: string;
  content: React.ReactNode;
}

function formatFrameRateCapValue(value: number): string {
  return value <= 0 ? "Uncapped" : `${value} FPS`;
}

function frameRateCapToSliderValue(value: number): number {
  return value <= 0 ? 125 : value;
}

function sliderValueToFrameRateCap(value: number): number {
  return value >= 125 ? 0 : value;
}

function formatIdleFrameRateCapValue(value: number): string {
  return `${value} FPS`;
}

export function MapDebugParameters({
  settings,
  onChange,
  renderDistance,
  onRenderDistanceChange,
  voxelLod1MaxDist,
  onVoxelLod1MaxDistChange,
  minRenderedVoxelLod,
  onMinRenderedVoxelLodChange,
  chunkBorders,
  voxelHeights,
  onChunkBordersChange,
  onVoxelHeightsChange,
}: MapDebugParametersProps) {
  const definitionsBySection = useMemo(() => {
    const grouped = new Map<DebugSection, MapDebugParameterDefinition[]>();
    for (const section of SECTION_ORDER) grouped.set(section, []);
    for (const definition of MAP_DEBUG_PARAMETER_DEFINITIONS) {
      grouped.get(definition.section)?.push(definition);
    }
    return grouped;
  }, []);

  const sections = useMemo<ControlSection[]>(() => {
    const baseSections: ControlSection[] = [
      {
        title: "Visual Debug",
        content: (
          <>
            <ToggleRow
              label="Chunk Borders"
              active={chunkBorders}
              onToggle={() => onChunkBordersChange(!chunkBorders)}
            />
            <ToggleRow
              label="Voxel Heights"
              active={voxelHeights}
              onToggle={() => onVoxelHeightsChange(!voxelHeights)}
            />
          </>
        ),
      },
      {
        title: "Performance",
        content: (
          <>
            <SliderRow
              label="Frame Rate Cap"
              description="Caps the main render loop. Set the slider to Uncapped to let rendering run at the display sync rate."
              value={frameRateCapToSliderValue(settings.frameRateCapFps)}
              displayValue={formatFrameRateCapValue(settings.frameRateCapFps)}
              min={30}
              max={125}
              step={5}
              defaultValue={frameRateCapToSliderValue(60)}
              onChange={(value) =>
                onChange({
                  ...settings,
                  frameRateCapFps: sliderValueToFrameRateCap(value),
                })
              }
            />
            <SliderRow
              label="Idle Frame Rate"
              description="Target frame rate once the scene is fully idle and the mouse is not hovering over the canvas."
              value={settings.idleFrameRateCapFps}
              displayValue={formatIdleFrameRateCapValue(
                settings.idleFrameRateCapFps,
              )}
              min={5}
              max={60}
              step={5}
              defaultValue={15}
              onChange={(value) =>
                onChange({ ...settings, idleFrameRateCapFps: value })
              }
            />
          </>
        ),
      },
    ];

    baseSections.push({
      title: "Voxel Rendering",
      content: (
        <>
          <SliderRow
            label="Render Distance"
            description="Maximum distance around the camera where voxel regions remain eligible for loading and rendering."
            value={renderDistance}
            displayValue={String(renderDistance)}
            min={3200}
            max={38400}
            step={800}
            defaultValue={19200}
            onChange={onRenderDistanceChange}
          />
          <SliderRow
            label="LOD1 Max Dist"
            description={
              minRenderedVoxelLod > 1
                ? "Distance threshold where the finest voxel LOD stops being preferred. Inactive while Min LOD is above 1."
                : "Distance threshold where the finest voxel LOD stops being preferred."
            }
            value={voxelLod1MaxDist}
            displayValue={String(voxelLod1MaxDist)}
            min={200}
            max={1150}
            step={50}
            defaultValue={600}
            onChange={onVoxelLod1MaxDistChange}
            disabled={minRenderedVoxelLod > 1}
          />
          <DiscreteLodRow
            label="Min LOD"
            description="Finest voxel LOD allowed to render. Higher values prevent very fine voxel regions from being selected."
            value={minRenderedVoxelLod}
            defaultValue={LOD_LEVELS[0]}
            onChange={onMinRenderedVoxelLodChange}
          />
          <SliderRow
            label="Top AO Intensity"
            description="Scales seam-aware top-face AO for L1 and L2."
            value={settings.voxelTopAoIntensity}
            displayValue={settings.voxelTopAoIntensity.toFixed(2)}
            min={0}
            max={1.5}
            step={0.05}
            defaultValue={DEFAULT_MAP_DEBUG_SETTINGS.voxelTopAoIntensity}
            onChange={(value) =>
              onChange({ ...settings, voxelTopAoIntensity: value })
            }
          />
          <SliderRow
            label="Wall AO Intensity"
            description="Scales server-baked vertical-wall AO, including full-height concave wall corners, for L1 and L2."
            value={settings.voxelWallAoIntensity}
            displayValue={settings.voxelWallAoIntensity.toFixed(2)}
            min={0}
            max={1.5}
            step={0.05}
            defaultValue={DEFAULT_MAP_DEBUG_SETTINGS.voxelWallAoIntensity}
            onChange={(value) =>
              onChange({ ...settings, voxelWallAoIntensity: value })
            }
          />
        </>
      ),
    });

    for (const section of SECTION_ORDER) {
      const items = definitionsBySection.get(section) ?? [];
      if (items.length === 0) continue;
      baseSections.push({
        title: section,
        content: items.map((definition) => (
          <ParameterRow
            key={definition.key}
            definition={definition}
            value={settings[definition.key]}
            onChange={(value) =>
              onChange({ ...settings, [definition.key]: value })
            }
            onReset={() =>
              onChange({
                ...settings,
                [definition.key]: definition.defaultValue,
              })
            }
          />
        )),
      });
    }

    return baseSections;
  }, [
    chunkBorders,
    definitionsBySection,
    minRenderedVoxelLod,
    onChange,
    onChunkBordersChange,
    onMinRenderedVoxelLodChange,
    onRenderDistanceChange,
    onVoxelHeightsChange,
    onVoxelLod1MaxDistChange,
    renderDistance,
    settings,
    voxelHeights,
    voxelLod1MaxDist,
  ]);

  return (
    <>
      <style>{rangeSliderCss}</style>
      <div style={{ display: "grid", gap: 14 }}>
        {sections.map((section) => (
          <div key={section.title} style={{ display: "grid", gap: 10 }}>
            <div style={sectionTitleStyle}>{section.title}</div>
            {section.content}
          </div>
        ))}
      </div>
    </>
  );
}

function SliderRow({
  label,
  description,
  value,
  displayValue,
  min,
  max,
  step,
  defaultValue,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <SimpleParameterRow
      label={label}
      description={description}
      valueText={displayValue}
      isChanged={value !== defaultValue}
      onReset={() => onChange(defaultValue)}
      disabled={disabled}
    >
      <RangeSlider
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    </SimpleParameterRow>
  );
}

function DiscreteLodRow({
  label,
  description,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  defaultValue: number;
  onChange: (value: number) => void;
}) {
  const index = LOD_LEVELS.indexOf(value);
  return (
    <SimpleParameterRow
      label={label}
      description={description}
      valueText={`L${value}`}
      isChanged={value !== defaultValue}
      onReset={() => onChange(defaultValue)}
    >
      <RangeSlider
        min={0}
        max={LOD_LEVELS.length - 1}
        step={1}
        value={Math.max(index, 0)}
        onChange={(nextIndex) =>
          onChange(LOD_LEVELS[nextIndex] ?? defaultValue)
        }
      />
    </SimpleParameterRow>
  );
}

function RangeSlider({
  min,
  max,
  step,
  value,
  onChange,
  disabled = false,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const progress = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const clampedProgress = Math.min(Math.max(progress, 0), 100);

  return (
    <input
      className="map-debug-slider"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "default" : "pointer",
        ["--slider-progress" as string]: `${clampedProgress}%`,
        ["--slider-fill" as string]: uiTheme.accent.text,
        ["--slider-track" as string]: "rgba(255,255,255,0.14)",
        ["--slider-thumb" as string]: "rgb(86, 200, 116)",
        ["--slider-thumb-border" as string]: uiTheme.accent.border,
      }}
    />
  );
}

function SimpleParameterRow({
  label,
  description,
  valueText,
  isChanged,
  onReset,
  disabled = false,
  children,
}: {
  label: string;
  description: string;
  valueText: string;
  isChanged: boolean;
  onReset: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <ParameterChrome
      label={label}
      description={description}
      valueText={valueText}
      isChanged={isChanged}
      onReset={onReset}
      disabled={disabled}
    >
      {children}
    </ParameterChrome>
  );
}

function ParameterChrome({
  label,
  description,
  valueText,
  isChanged,
  onReset,
  disabled = false,
  children,
}: {
  label: string;
  description: string;
  valueText: string;
  isChanged: boolean;
  onReset: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div style={{ display: "grid", gap: 6, position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}
        >
          <span
            style={{
              color: uiTheme.text.secondary,
              fontSize: 12,
              fontWeight: 400,
            }}
          >
            {label}
          </span>
          <button
            type="button"
            onMouseEnter={() => setShowHelp(true)}
            onMouseLeave={() => setShowHelp(false)}
            onFocus={() => setShowHelp(true)}
            onBlur={() => setShowHelp(false)}
            style={helpButtonStyle}
            title={description}
            aria-label={`${label} help`}
          >
            ?
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              color: disabled ? uiTheme.text.disabled : uiTheme.accent.text,
              fontSize: 12,
              fontWeight: 400,
              whiteSpace: "nowrap",
            }}
          >
            {valueText}
          </span>
          {isChanged && (
            <button
              type="button"
              onClick={onReset}
              style={resetButtonStyle}
              disabled={disabled}
              title={`Reset ${label}`}
              aria-label={`Reset ${label}`}
            >
              <ResetGlyph />
            </button>
          )}
        </div>
      </div>

      {showHelp && <div style={tooltipStyle}>{description}</div>}

      {children}
    </div>
  );
}

function ParameterRow({
  definition,
  value,
  onChange,
  onReset,
}: {
  definition: MapDebugParameterDefinition;
  value: number;
  onChange: (value: number) => void;
  onReset: () => void;
}) {
  const displayValue = definition.toDisplay
    ? definition.toDisplay(value)
    : value;
  const isChanged = value !== definition.defaultValue;
  const valueText = definition.formatDisplay
    ? definition.formatDisplay(displayValue)
    : formatNumeric(
        displayValue,
        definition.decimals ?? (definition.step < 1 ? 2 : 0),
      );

  const commitValue = (nextDisplayValue: number) => {
    const raw = definition.fromDisplay
      ? definition.fromDisplay(nextDisplayValue)
      : nextDisplayValue;
    const min = definition.fromDisplay
      ? definition.fromDisplay(definition.min)
      : definition.min;
    const max = definition.fromDisplay
      ? definition.fromDisplay(definition.max)
      : definition.max;
    const clamped = Math.min(Math.max(raw, min), max);
    const decimals = definition.decimals ?? (definition.step < 1 ? 2 : 0);
    const next =
      decimals > 0 ? Number(clamped.toFixed(decimals)) : Math.round(clamped);
    onChange(next);
  };

  return (
    <ParameterChrome
      label={definition.label}
      description={definition.description}
      valueText={valueText}
      isChanged={isChanged}
      onReset={onReset}
    >
      <RangeSlider
        min={definition.min}
        max={definition.max}
        step={definition.step}
        value={displayValue}
        onChange={commitValue}
      />
    </ParameterChrome>
  );
}

function ToggleRow({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        width: "100%",
        padding: "7px 10px",
        borderRadius: 0,
        border: `2px solid ${active ? uiTheme.accent.border : uiTheme.panel.buttonBorderMuted}`,
        background: active
          ? "rgba(125, 242, 170, 0.12)"
          : uiTheme.panel.buttonBackgroundMuted,
        color: uiTheme.text.secondary,
        cursor: "pointer",
        boxShadow: "2px 2px 0 rgba(0,0,0,0.5)",
      }}
    >
      <span
        style={{ fontSize: 12, fontWeight: 400, textTransform: "uppercase" }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 400,
          color: active ? uiTheme.text.accent : uiTheme.text.muted,
        }}
      >
        {active ? "On" : "Off"}
      </span>
    </button>
  );
}

function formatNumeric(value: number, decimals: number): string {
  return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
}

const rangeSliderCss = `
  .map-debug-slider {
    width: 100%;
    height: 14px;
    margin: 0;
    background: transparent;
    appearance: none;
    -webkit-appearance: none;
  }

  .map-debug-slider:focus {
    outline: none;
  }

  .map-debug-slider::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: 0;
    border: 2px solid var(--slider-thumb-border);
    background: linear-gradient(
      90deg,
      var(--slider-fill) 0%,
      var(--slider-fill) var(--slider-progress),
      var(--slider-track) var(--slider-progress),
      var(--slider-track) 100%
    );
  }

  .map-debug-slider::-webkit-slider-thumb {
    width: 16px;
    height: 16px;
    margin-top: -6px;
    border-radius: 0;
    border: 2px solid var(--slider-thumb-border);
    background: var(--slider-thumb);
    box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.45);
    appearance: none;
    -webkit-appearance: none;
  }

  .map-debug-slider::-moz-range-track {
    height: 6px;
    border: 2px solid var(--slider-thumb-border);
    border-radius: 0;
    background: var(--slider-track);
  }

  .map-debug-slider::-moz-range-progress {
    height: 6px;
    border-radius: 0;
    background: var(--slider-fill);
  }

  .map-debug-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 0;
    border: 2px solid var(--slider-thumb-border);
    background: var(--slider-thumb);
    box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.45);
  }
`;

const sectionTitleStyle: React.CSSProperties = {
  color: uiTheme.accent.text,
  fontSize: 12,
  fontWeight: 400,
};

const helpButtonStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: 0,
  border: `2px solid ${uiTheme.panel.buttonBorder}`,
  background: uiTheme.panel.buttonBackground,
  color: uiTheme.text.primary,
  fontSize: 12,
  fontWeight: 400,
  cursor: "help",
  padding: 0,
  lineHeight: "16px",
  flexShrink: 0,
  boxShadow: "2px 2px 0 rgba(0,0,0,0.5)",
};

const resetButtonStyle: React.CSSProperties = {
  border: `2px solid ${uiTheme.panel.buttonBorder}`,
  background: uiTheme.panel.buttonBackground,
  color: uiTheme.text.primary,
  borderRadius: 0,
  width: 24,
  height: 24,
  cursor: "pointer",
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "2px 2px 0 rgba(0,0,0,0.5)",
};

const tooltipStyle: React.CSSProperties = {
  position: "absolute",
  top: -4,
  right: 0,
  transform: "translateY(-100%)",
  maxWidth: 260,
  background: uiTheme.panel.tooltipBackground,
  border: `2px solid ${uiTheme.panel.tooltipBorder}`,
  borderRadius: 0,
  padding: "8px 10px",
  color: uiTheme.text.secondary,
  fontSize: 12,
  lineHeight: 1.25,
  boxShadow: "4px 4px 0 rgba(0,0,0,0.55)",
  zIndex: 5,
};

function ResetGlyph() {
  return (
    <svg
      width={RESET_GLYPH_SIZE}
      height={RESET_GLYPH_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ pointerEvents: "none", display: "block" }}
    >
      <path d="M3 12a9 9 0 1 0 3-6.708" />
      <path d="M3 3v6h6" />
    </svg>
  );
}
