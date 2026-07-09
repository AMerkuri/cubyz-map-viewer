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

export function formatNullableMs(value: number | null): string {
  if (value === null) return "n/a";
  return `${value.toFixed(1)} ms`;
}

export function formatNullableCount(value: number | null): string {
  if (value === null) return "n/a";
  return Math.round(value).toString();
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
