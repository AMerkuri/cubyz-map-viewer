import { OverlayPanel } from "../../../components/OverlayPanel.js";
import { uiTheme } from "../../../lib/ui-theme.js";
import type { ChunkStats } from "../../../lib/world-view-debug.js";
import { DebugStatsContent } from "./DebugStatsContent.js";

export function DebugStatsPanel({ chunkStats }: { chunkStats: ChunkStats }) {
  return (
    <OverlayPanel
      title="Stats"
      position={{ top: 54, right: 12 }}
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
      <DebugStatsContent chunkStats={chunkStats} />
    </OverlayPanel>
  );
}
