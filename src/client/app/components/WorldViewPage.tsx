import { WorldControlsProvider } from "../../features/world-controls/WorldControlsProvider.js";
import {
  readInitialCameraState,
  readInitialMode,
} from "../../lib/world-view-url-state.js";
import { WorldViewPageContent } from "./WorldViewPageContent.js";

export function WorldViewPage() {
  const initialMode = readInitialMode();
  const initialCameraState = readInitialCameraState();

  return (
    <WorldControlsProvider initialMode={initialMode}>
      <WorldViewPageContent initialCameraState={initialCameraState} />
    </WorldControlsProvider>
  );
}
