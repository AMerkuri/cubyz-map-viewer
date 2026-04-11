interface ViewToggleProps {
  view: "terrain" | "voxel";
  onViewChange: (view: "terrain" | "voxel") => void;
}

export function ViewToggle({ view, onViewChange }: ViewToggleProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        borderRadius: 6,
        overflow: "hidden",
        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
      }}
    >
      <button
        type="button"
        onClick={() => onViewChange("terrain")}
        style={{
          padding: "8px 16px",
          border: "none",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          background: view === "terrain" ? "#4a90d9" : "#2a2a3e",
          color: view === "terrain" ? "#fff" : "#aaa",
          transition: "all 0.2s",
        }}
      >
        Terrain
      </button>
      <button
        type="button"
        onClick={() => onViewChange("voxel")}
        style={{
          padding: "8px 16px",
          border: "none",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          background: view === "voxel" ? "#4a90d9" : "#2a2a3e",
          color: view === "voxel" ? "#fff" : "#aaa",
          transition: "all 0.2s",
        }}
      >
        Voxels
      </button>
    </div>
  );
}
