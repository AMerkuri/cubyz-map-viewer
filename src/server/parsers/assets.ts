import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface AssetNamespaceSource {
  namespace: string;
  rootDir: string;
}

export async function discoverAssetNamespaceSources(
  assetRoots: readonly string[],
): Promise<AssetNamespaceSource[]> {
  const sources: AssetNamespaceSource[] = [];

  for (const assetRoot of assetRoots) {
    let entries: string[];
    try {
      entries = await readdir(assetRoot);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const rootDir = join(assetRoot, entry);
      sources.push({
        namespace: entry,
        rootDir,
      });
    }
  }

  return sources;
}
