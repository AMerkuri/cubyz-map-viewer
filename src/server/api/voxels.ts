/**
 * Voxels API route.
 * GET /api/voxels/:lod/:regionX/:regionY
 *   lod is one of 1,2,4,8,16,32
 *   regionX, regionY must be multiples of 128*lod (one voxel region column).
 *   Returns a compact binary voxel mesh (application/octet-stream).
 *   See greedy-mesh.ts for the exact binary layout.
 */

import { Router, type Request, type Response } from "express";
import { join } from "path";
import { readdir } from "fs/promises";
import { existsSync } from "fs";
import { createHash } from "crypto";
import { parseRegionFile, CHUNK_SIZE, REGION_SIZE } from "../parsers/region.js";
import { greedyMeshBinary, VOXEL_REGION_SIZE } from "../services/greedy-mesh.js";
import { parseSurfaceFile, MAP_SIZE } from "../parsers/surface.js";
import { LRUCache } from "../services/cache.js";
import type { ColorMapService } from "../services/color-map.js";

const VALID_LODS = [1, 2, 4, 8, 16, 32];

/** Maximum number of Z-region layers to process (top-most first) */
const MAX_Z_SLICES = 8;

/**
 * Maximum depth (in blocks) below the minimum surface height of a region column
 * at which voxels are still included. Regions whose chunk data lies entirely
 * below this threshold — or that have no surface file at all — are skipped so
 * that underground-only explored areas do not appear as floating islands.
 */
const MAX_UNDERGROUND_DEPTH = 128;

/** One voxel region column is always 128 cells in X and Y. */
const COLUMN_VOXELS = VOXEL_REGION_SIZE; // 128

function etagMatches(ifNoneMatch: string | string[] | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const value = Array.isArray(ifNoneMatch) ? ifNoneMatch.join(",") : ifNoneMatch;
  const tags = value.split(",").map((tag) => tag.trim());
  return tags.includes("*") || tags.includes(etag);
}

interface SurfaceCutoff {
  cutoffZ: number;
  hasSurface: boolean;
}

/**
 * Server-side LRU cache for computed binary voxel meshes.
 * Keyed by "lod/regionX/regionY". Stores binary payload and ETag.
 * Invalidated externally via clearVoxelCache() when a region file changes.
 */
interface CachedVoxelMesh {
  buf: Buffer;
  etag: string;
}

const voxelMeshCache = new LRUCache<string, CachedVoxelMesh>(256);
const VOXEL_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const VOXEL_MISS_CACHE_CONTROL = "no-store";

/** Remove a single entry from the voxel mesh cache when a region changes. */
export function clearVoxelCache(key: string): void {
  voxelMeshCache.delete(key);
}

/** Remove all voxel mesh cache entries. */
export function clearAllVoxelCache(): void {
  voxelMeshCache.clear();
}

export function createVoxelsRouter(
  savePath: string,
  colorMap: ColorMapService,
): Router {
  const router = Router();

  router.get("/:lod/:regionX/:regionY", async (req: Request, res: Response) => {
    try {
      const lod = parseInt(req.params.lod as string);
      const regionX = parseInt(req.params.regionX as string);
      const regionY = parseInt(req.params.regionY as string);
      const columnWorldSpan = COLUMN_VOXELS * lod;
      const regionSpanWorld = REGION_SIZE * CHUNK_SIZE * lod;

      if (
        !VALID_LODS.includes(lod) ||
        isNaN(regionX) ||
        isNaN(regionY) ||
        regionX % columnWorldSpan !== 0 ||
        regionY % columnWorldSpan !== 0
      ) {
        res.status(400).json({ error: "Invalid lod/region coordinates" });
        return;
      }

      const cacheKey = `${lod}/${regionX}/${regionY}`;
      const ifNoneMatch = req.headers["if-none-match"];

      // Serve from cache if available
      const cached = voxelMeshCache.get(cacheKey);
      if (cached) {
        res.set("Cache-Control", VOXEL_CACHE_CONTROL);
        res.set("ETag", cached.etag);
        if (etagMatches(ifNoneMatch, cached.etag)) {
          res.status(304).end();
          return;
        }
        res.set("Content-Type", "application/octet-stream");
        res.send(cached.buf);
        return;
      }

      // Path to the directory containing Z-slice region files for this column
      const colDir = join(savePath, "chunks", String(lod), String(regionX), String(regionY));

      if (!existsSync(colDir)) {
        res.set("Cache-Control", VOXEL_MISS_CACHE_CONTROL);
        res.status(204).end();
        return;
      }

      // List available Z values (each is a directory or file named after worldZ)
      let zEntries: string[];
      try {
        zEntries = await readdir(colDir);
      } catch {
        res.set("Cache-Control", VOXEL_MISS_CACHE_CONTROL);
        res.status(204).end();
        return;
      }

      // Each entry is a .region file named "{worldZ}.region"
      const allZValues = zEntries
        .filter((e) => e.endsWith(".region"))
        .map((e) => parseInt(e.slice(0, -".region".length)))
        .filter((z) => !isNaN(z))
        .sort((a, b) => b - a); // descending — topmost first

      if (allZValues.length === 0) {
        res.set("Cache-Control", VOXEL_MISS_CACHE_CONTROL);
        res.status(204).end();
        return;
      }

      // --- Surface-height clipping ---
      // Prefer same-LOD surface data, but fall back to maps/1 when higher
      // surface LODs are missing (common in downloaded saves).
      const surfaceCutoff = await computeSurfaceCutoff(savePath, regionX, regionY, lod);
      if (!surfaceCutoff.hasSurface) {
        // This XY column has no surface data — it was explored from underground
        // only. Rendering it would produce floating underground islands.
        res.set("Cache-Control", VOXEL_MISS_CACHE_CONTROL);
        res.status(204).end();
        return;
      }
      const cutoffZ = surfaceCutoff.cutoffZ;

      // Keep only the MAX_Z_SLICES topmost slices that start at or above cutoffZ.
      const zValues = allZValues
        .filter((z) => z >= cutoffZ)
        .slice(0, MAX_Z_SLICES);

      if (zValues.length === 0) {
        res.set("Cache-Control", VOXEL_MISS_CACHE_CONTROL);
        res.status(204).end();
        return;
      }

      // Determine total Z height covered
      const minWorldZ = Math.min(...zValues);
      const maxWorldZ = Math.max(...zValues) + regionSpanWorld;
      const totalHeight = Math.floor((maxWorldZ - minWorldZ) / lod);

      // Build a 3D block type array in voxel-cell space:
      // [x * COLUMN_VOXELS * totalHeight + y * totalHeight + z]
      const blockTypes = new Uint16Array(COLUMN_VOXELS * COLUMN_VOXELS * totalHeight);

      for (const worldZ of zValues) {
        const filePath = join(colDir, `${worldZ}.region`);
        if (!existsSync(filePath)) continue;

        let region;
        try {
          region = await parseRegionFile(filePath, regionX, regionY, worldZ, lod);
        } catch (e) {
          console.warn(`Failed to parse region ${filePath}: ${e}`);
          continue;
        }

        // Each region contains 4×4×4 chunks.
        // Chunk index: i = rx * REGION_SIZE^2 + ry * REGION_SIZE + rz
        //   rx = 0..3 → local X offset in blocks: rx * CHUNK_SIZE
        //   ry = 0..3 → local Y offset in blocks: ry * CHUNK_SIZE
        //   rz = 0..3 → local Z offset in blocks: rz * CHUNK_SIZE + (worldZ - minWorldZ)
        for (const chunk of region.chunks) {
          if (!chunk) continue;

          const baseX = chunk.rx * CHUNK_SIZE;
          const baseY = chunk.ry * CHUNK_SIZE;
          const baseZ = Math.floor((worldZ - minWorldZ) / lod) + chunk.rz * CHUNK_SIZE;

          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            for (let ly = 0; ly < CHUNK_SIZE; ly++) {
              for (let lz = 0; lz < CHUNK_SIZE; lz++) {
                const blockValue = chunk.blocks[lx * CHUNK_SIZE * CHUNK_SIZE + ly * CHUNK_SIZE + lz];
                const typ = blockValue & 0xffff;
                if (typ === 0) continue;

                const gx = baseX + lx;
                const gy = baseY + ly;
                const gz = baseZ + lz;

                if (gx >= COLUMN_VOXELS || gy >= COLUMN_VOXELS || gz >= totalHeight) continue;

                blockTypes[gx * COLUMN_VOXELS * totalHeight + gy * totalHeight + gz] = typ;
              }
            }
          }
        }
      }

      const meshBuffer = greedyMeshBinary(
        blockTypes,
        COLUMN_VOXELS,
        COLUMN_VOXELS,
        totalHeight,
        regionX,
        regionY,
        minWorldZ,
        lod,
        colorMap,
      );

      const responseBuffer = Buffer.from(meshBuffer);
      const etag = `"voxels-${cacheKey}-${createHash("sha1").update(responseBuffer).digest("hex")}"`;
      voxelMeshCache.set(cacheKey, { buf: responseBuffer, etag });

      res.set("Cache-Control", VOXEL_CACHE_CONTROL);
      res.set("ETag", etag);
      if (etagMatches(ifNoneMatch, etag)) {
        res.status(304).end();
        return;
      }

      res.set("Content-Type", "application/octet-stream");
      res.send(responseBuffer);
    } catch (e) {
      console.error(`Voxels API error: ${e}`);
      res.status(500).json({ error: "Failed to generate voxel mesh" });
    }
  });

  return router;
}

async function computeSurfaceCutoff(
  savePath: string,
  regionX: number,
  regionY: number,
  lod: number,
): Promise<SurfaceCutoff> {
  const regionSpanWorld = COLUMN_VOXELS * lod;

  // Fast path: if same-LOD surface exists, use it directly.
  const sameTileSize = MAP_SIZE * lod;
  const sameTileX = Math.floor(regionX / sameTileSize) * sameTileSize;
  const sameTileY = Math.floor(regionY / sameTileSize) * sameTileSize;
  const samePath = join(savePath, "maps", String(lod), String(sameTileX), `${sameTileY}.surface`);
  if (existsSync(samePath)) {
    try {
      const surface = await parseSurfaceFile(samePath, sameTileX, sameTileY, lod);
      const localX0 = (regionX - sameTileX) / lod;
      const localY0 = (regionY - sameTileY) / lod;
      let minSurfaceH = Infinity;
      for (let lx = localX0; lx < localX0 + COLUMN_VOXELS; lx++) {
        for (let ly = localY0; ly < localY0 + COLUMN_VOXELS; ly++) {
          const h = surface.heights[lx * MAP_SIZE + ly];
          if (h < minSurfaceH) minSurfaceH = h;
        }
      }
      if (isFinite(minSurfaceH)) {
        return { cutoffZ: minSurfaceH - MAX_UNDERGROUND_DEPTH, hasSurface: true };
      }
    } catch (e) {
      console.warn(`Surface read failed for voxels ${regionX}/${regionY} (lod ${lod}): ${e}`);
    }
  }

  // Fallback path: sample overlapping maps/1 tiles for this world-space area.
  const x0 = regionX;
  const y0 = regionY;
  const x1 = regionX + regionSpanWorld;
  const y1 = regionY + regionSpanWorld;

  const tileXStart = Math.floor(x0 / MAP_SIZE) * MAP_SIZE;
  const tileYStart = Math.floor(y0 / MAP_SIZE) * MAP_SIZE;
  const tileXEnd = Math.floor((x1 - 1) / MAP_SIZE) * MAP_SIZE;
  const tileYEnd = Math.floor((y1 - 1) / MAP_SIZE) * MAP_SIZE;

  let minSurfaceH = Infinity;
  let foundSurface = false;

  for (let tileX = tileXStart; tileX <= tileXEnd; tileX += MAP_SIZE) {
    for (let tileY = tileYStart; tileY <= tileYEnd; tileY += MAP_SIZE) {
      const path = join(savePath, "maps", "1", String(tileX), `${tileY}.surface`);
      if (!existsSync(path)) continue;

      try {
        const surface = await parseSurfaceFile(path, tileX, tileY, 1);
        foundSurface = true;

        const lx0 = Math.max(0, x0 - tileX);
        const ly0 = Math.max(0, y0 - tileY);
        const lx1 = Math.min(MAP_SIZE, x1 - tileX);
        const ly1 = Math.min(MAP_SIZE, y1 - tileY);

        for (let lx = lx0; lx < lx1; lx++) {
          for (let ly = ly0; ly < ly1; ly++) {
            const h = surface.heights[lx * MAP_SIZE + ly];
            if (h < minSurfaceH) minSurfaceH = h;
          }
        }
      } catch (e) {
        console.warn(`Surface read failed for fallback voxels ${regionX}/${regionY} at ${path}: ${e}`);
      }
    }
  }

  if (!foundSurface || !isFinite(minSurfaceH)) {
    return { cutoffZ: -Infinity, hasSurface: false };
  }

  return { cutoffZ: minSurfaceH - MAX_UNDERGROUND_DEPTH, hasSurface: true };
}
