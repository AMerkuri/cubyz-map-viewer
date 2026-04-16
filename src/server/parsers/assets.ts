import { existsSync } from "node:fs";
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
      if (!existsSync(rootDir)) {
        continue;
      }
      sources.push({
        namespace: entry,
        rootDir,
      });
    }
  }

  return sources;
}

export function resolveNamespaceFile(
  assetSources: readonly AssetNamespaceSource[],
  namespace: string,
  ...pathSegments: string[]
): string | null {
  for (let index = assetSources.length - 1; index >= 0; index--) {
    const source = assetSources[index];
    if (!source || source.namespace !== namespace) {
      continue;
    }

    const filePath = join(source.rootDir, ...pathSegments);
    if (existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}
