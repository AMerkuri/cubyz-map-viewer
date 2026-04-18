import type { LoadingBreakdown } from "../lib/world-view-debug.js";

export function formatMemoryBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatNullableBytes(bytes: number | null): string {
  if (bytes === null) return "n/a";
  return formatMemoryBytes(Math.round(bytes));
}

export function isLoadingBreakdownActive(
  loadingBreakdown: LoadingBreakdown,
): boolean {
  return (
    loadingBreakdown.terrain +
      loadingBreakdown.voxels +
      loadingBreakdown.fetchQueue +
      loadingBreakdown.meshQueue >
    0
  );
}
