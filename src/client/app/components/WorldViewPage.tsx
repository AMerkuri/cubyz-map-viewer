import { WorldControlsProvider } from "../../features/world-controls/WorldControlsProvider.js";
import { readInitialCameraState } from "../../lib/world-view-url-state.js";
import { WorldViewPageContent } from "./WorldViewPageContent.js";

export function WorldViewPage() {
  const initialCameraState = readInitialCameraState();

  return (
    <WorldControlsProvider>
      <WorldViewPageContent initialCameraState={initialCameraState} />
    </WorldControlsProvider>
  );
}
