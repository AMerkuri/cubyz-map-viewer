interface ViewToggleProps {
  view: "2d" | "3d";
  onViewChange: (view: "2d" | "3d") => void;
}

export function ViewToggle({ view, onViewChange }: ViewToggleProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 1000,
        display: "flex",
        gap: 0,
        borderRadius: 6,
        overflow: "hidden",
        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
      }}
    >
      <button
        onClick={() => onViewChange("2d")}
        style={{
          padding: "8px 16px",
          border: "none",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          background: view === "2d" ? "#4a90d9" : "#2a2a3e",
          color: view === "2d" ? "#fff" : "#aaa",
          transition: "all 0.2s",
        }}
      >
        2D Map
      </button>
      <button
        onClick={() => onViewChange("3d")}
        style={{
          padding: "8px 16px",
          border: "none",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          background: view === "3d" ? "#4a90d9" : "#2a2a3e",
          color: view === "3d" ? "#fff" : "#aaa",
          transition: "all 0.2s",
        }}
      >
        3D Terrain
      </button>
    </div>
  );
}
