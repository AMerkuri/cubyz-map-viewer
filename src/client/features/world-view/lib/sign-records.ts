import type { QueryClient } from "@tanstack/react-query";

/** Sign text is fetched and rendered only at the finest detail level. */
export const SIGN_TEXT_LOD = 1;

export interface SignRecordCorner {
  x: number;
  y: number;
  z: number;
}

export interface SignRecord {
  position: SignRecordCorner;
  data: number;
  text: string;
  corners: [
    SignRecordCorner,
    SignRecordCorner,
    SignRecordCorner,
    SignRecordCorner,
  ];
}

export function signRecordsQueryKey(
  lod: number,
  regionX: number,
  regionY: number,
): [string, number, number, number] {
  return ["signs", lod, regionX, regionY];
}

/**
 * Fetch per-region sign records through the React Query cache. Keyed by LOD +
 * region coordinate, consistent with voxel/region data loading. Records are
 * cached indefinitely and invalidated explicitly on world-update WebSocket
 * events.
 */
export async function fetchSignRecords(args: {
  queryClient: QueryClient;
  lod: number;
  regionX: number;
  regionY: number;
  signal?: AbortSignal;
}): Promise<SignRecord[]> {
  const { queryClient, lod, regionX, regionY, signal } = args;
  return queryClient.fetchQuery<SignRecord[]>({
    queryKey: signRecordsQueryKey(lod, regionX, regionY),
    queryFn: async () => {
      const res = await fetch(`/api/signs/${lod}/${regionX}/${regionY}`, {
        signal,
      });
      if (!res.ok) throw new Error(`Sign records fetch failed (${res.status})`);
      return res.json() as Promise<SignRecord[]>;
    },
    staleTime: Infinity,
  });
}
