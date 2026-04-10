import { useMemo, useState } from "react";
import {
  MAP_DEBUG_PARAMETER_DEFINITIONS,
  type MapDebugParameterDefinition,
  type MapDebugSettings,
} from "../mapDebug.js";

interface MapDebugParametersProps {
  settings: MapDebugSettings;
  onChange: (next: MapDebugSettings) => void;
  chunkBorders: boolean;
  voxelHeights: boolean;
  onChunkBordersChange: (active: boolean) => void;
  onVoxelHeightsChange: (active: boolean) => void;
}

const SECTION_ORDER = ["Loading", "LOD", "Focus", "Memory"] as const;
const RESET_GLYPH_SIZE = 12;

export function MapDebugParameters({
  settings,
  onChange,
  chunkBorders,
  voxelHeights,
  onChunkBordersChange,
  onVoxelHeightsChange,
}: MapDebugParametersProps) {
  const definitionsBySection = useMemo(() => {
    const grouped = new Map<(typeof SECTION_ORDER)[number], MapDebugParameterDefinition[]>();
    for (const section of SECTION_ORDER) grouped.set(section, []);
    for (const definition of MAP_DEBUG_PARAMETER_DEFINITIONS) {
      grouped.get(definition.section)?.push(definition);
    }
    return grouped;
  }, []);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={sectionTitleStyle}>Visual Debug</div>
        <ToggleRow label="Chunk Borders" active={chunkBorders} onToggle={() => onChunkBordersChange(!chunkBorders)} />
        <ToggleRow label="Voxel Heights" active={voxelHeights} onToggle={() => onVoxelHeightsChange(!voxelHeights)} />
      </div>

      {SECTION_ORDER.map((section) => {
        const items = definitionsBySection.get(section) ?? [];
        if (items.length === 0) return null;
        return (
          <div key={section} style={{ display: "grid", gap: 10 }}>
            <div style={sectionTitleStyle}>{section}</div>
            {items.map((definition) => (
              <ParameterRow
                key={definition.key}
                definition={definition}
                value={settings[definition.key]}
                onChange={(value) => onChange({ ...settings, [definition.key]: value })}
                onReset={() => onChange({ ...settings, [definition.key]: definition.defaultValue })}
              />
            ))}
          </div>
        );
      })}
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
  const [showHelp, setShowHelp] = useState(false);
  const displayValue = definition.toDisplay ? definition.toDisplay(value) : value;
  const isChanged = value !== definition.defaultValue;
  const valueText = definition.formatDisplay
    ? definition.formatDisplay(displayValue)
    : formatNumeric(displayValue, definition.decimals ?? (definition.step < 1 ? 2 : 0));

  const commitValue = (nextDisplayValue: number) => {
    const raw = definition.fromDisplay ? definition.fromDisplay(nextDisplayValue) : nextDisplayValue;
    const min = definition.fromDisplay ? definition.fromDisplay(definition.min) : definition.min;
    const max = definition.fromDisplay ? definition.fromDisplay(definition.max) : definition.max;
    const clamped = Math.min(Math.max(raw, min), max);
    const decimals = definition.decimals ?? (definition.step < 1 ? 2 : 0);
    const next = decimals > 0 ? Number(clamped.toFixed(decimals)) : Math.round(clamped);
    onChange(next);
  };

  return (
    <div style={{ display: "grid", gap: 6, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ color: "#d6d9ea", fontSize: 12, fontWeight: 600 }}>{definition.label}</span>
          <button
            type="button"
            onMouseEnter={() => setShowHelp(true)}
            onMouseLeave={() => setShowHelp(false)}
            onFocus={() => setShowHelp(true)}
            onBlur={() => setShowHelp(false)}
            style={helpButtonStyle}
            title={definition.description}
            aria-label={`${definition.label} help`}
          >
            ?
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#8fa4e8", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>{valueText}</span>
          {isChanged && (
            <button
              type="button"
              onClick={onReset}
              style={resetButtonStyle}
              title={`Reset ${definition.label}`}
              aria-label={`Reset ${definition.label}`}
            >
              <ResetGlyph />
            </button>
          )}
        </div>
      </div>

      {showHelp && (
        <div style={tooltipStyle}>
          {definition.description}
        </div>
      )}

      <input
        type="range"
        min={definition.min}
        max={definition.max}
        step={definition.step}
        value={displayValue}
        onChange={(e) => commitValue(Number(e.target.value))}
      />
    </div>
  );
}

function ToggleRow({ label, active, onToggle }: { label: string; active: boolean; onToggle: () => void }) {
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
        borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.1)",
        background: "rgba(255,255,255,0.04)",
        color: "#d6d9ea",
        cursor: "pointer",
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: active ? "#8ff0a4" : "#8b92ad",
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

const sectionTitleStyle: React.CSSProperties = {
  color: "#8fa4e8",
  fontSize: 12,
  fontWeight: 700,
};

const helpButtonStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  color: "#cfd8ff",
  fontSize: 11,
  fontWeight: 700,
  cursor: "help",
  padding: 0,
  lineHeight: "16px",
  flexShrink: 0,
};

const resetButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  color: "#cfd8ff",
  borderRadius: 4,
  width: 24,
  height: 24,
  cursor: "pointer",
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const tooltipStyle: React.CSSProperties = {
  position: "absolute",
  top: -4,
  right: 0,
  transform: "translateY(-100%)",
  maxWidth: 260,
  background: "rgba(8, 10, 18, 0.96)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 6,
  padding: "8px 10px",
  color: "#d6d9ea",
  fontSize: 11,
  lineHeight: 1.45,
  boxShadow: "0 8px 18px rgba(0,0,0,0.35)",
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
