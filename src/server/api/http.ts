import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";

import { isNodeErrorWithCode } from "./errors.js";

export function etagMatches(
  ifNoneMatch: string | string[] | undefined,
  etag: string,
): boolean {
  if (!ifNoneMatch) return false;
  const value = Array.isArray(ifNoneMatch)
    ? ifNoneMatch.join(",")
    : ifNoneMatch;
  const tags = value.split(",").map((tag) => tag.trim());
  return tags.includes("*") || tags.includes(etag);
}

export async function statIfExists(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
