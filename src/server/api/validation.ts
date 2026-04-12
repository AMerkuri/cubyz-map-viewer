import { BadRequestError } from "./errors.js";

export const VALID_LODS = [1, 2, 4, 8, 16, 32] as const;

export interface TileParams {
  lod: number;
  x: number;
  y: number;
}

export interface RegionParams {
  lod: number;
  regionX: number;
  regionY: number;
}

export function parseIntegerParam(
  value: string | undefined,
  name: string,
): number {
  if (value === undefined) {
    throw new BadRequestError(`Missing ${name}`);
  }

  if (!/^-?\d+$/.test(value)) {
    throw new BadRequestError(`Invalid ${name}`);
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new BadRequestError(`Invalid ${name}`);
  }

  return parsed;
}

export function parseLodParam(value: string | undefined): number {
  const lod = parseIntegerParam(value, "lod");
  if (!VALID_LODS.includes(lod as (typeof VALID_LODS)[number])) {
    throw new BadRequestError("Invalid lod");
  }
  return lod;
}

export function parseTileParams(params: {
  lod?: string;
  x?: string;
  y?: string;
}): TileParams {
  return {
    lod: parseLodParam(params.lod),
    x: parseIntegerParam(params.x, "x"),
    y: parseIntegerParam(params.y, "y"),
  };
}

export function parseRegionParams(params: {
  lod?: string;
  regionX?: string;
  regionY?: string;
}): RegionParams {
  return {
    lod: parseLodParam(params.lod),
    regionX: parseIntegerParam(params.regionX, "regionX"),
    regionY: parseIntegerParam(params.regionY, "regionY"),
  };
}

export function assertAlignedRegion(
  lod: number,
  regionX: number,
  regionY: number,
  columnWorldSpan = 128 * lod,
): void {
  if (regionX % columnWorldSpan !== 0 || regionY % columnWorldSpan !== 0) {
    throw new BadRequestError("Invalid lod/region coordinates");
  }
}

export function parseSafeAssetName(
  value: string | undefined,
  label: string,
): string {
  if (!value) {
    throw new BadRequestError(`Missing ${label}`);
  }

  if (value.includes("..") || !/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new BadRequestError(`Invalid ${label}`);
  }

  return value;
}
