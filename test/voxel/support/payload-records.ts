import {
  getBinaryQuadPositionOffset,
  readBinaryHeader,
} from "../../../src/server/services/greedy-mesh.js";
import type { Point } from "./fixture-world.js";

export type EmitterRecord = Point & {
  r: number;
  g: number;
  b: number;
  halo: boolean;
  openFaces: number;
};

export function decodeEmitterRecords(buffer: ArrayBuffer): EmitterRecord[] {
  const view = new DataView(buffer);
  const header = readBinaryHeader(view, buffer.byteLength);
  let offset =
    getBinaryQuadPositionOffset(buffer) +
    (header.greedyRecordCount ?? 0) * 12 +
    (header.modelRecordCount ?? 0) * 48;
  const records: EmitterRecord[] = [];
  for (let index = 0; index < (header.emitterRecordCount ?? 0); index++) {
    const flags = view.getUint8(offset + 15);
    records.push({
      x: view.getInt32(offset, true),
      y: view.getInt32(offset + 4, true),
      z: view.getInt32(offset + 8, true),
      r: view.getUint8(offset + 12),
      g: view.getUint8(offset + 13),
      b: view.getUint8(offset + 14),
      halo: (flags & 1) !== 0,
      openFaces: flags >> 1,
    });
    offset += 16;
  }
  return records;
}

export function recordKey(record: EmitterRecord): string {
  return `${record.x}/${record.y}/${record.z}/${record.r}/${record.g}/${record.b}/${Number(record.halo)}/${record.openFaces}`;
}
export function compareRecords(a: EmitterRecord, b: EmitterRecord): number {
  return (
    Number(a.halo) - Number(b.halo) ||
    a.x - b.x ||
    a.y - b.y ||
    a.z - b.z ||
    a.r - b.r ||
    a.g - b.g ||
    a.b - b.b
  );
}
export function normalizedPayloadBytes(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer.slice(0));
}

export function getEmitterRecordOffset(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);
  const header = readBinaryHeader(view, buffer.byteLength);
  return (
    getBinaryQuadPositionOffset(buffer) +
    (header.greedyRecordCount ?? 0) * 12 +
    (header.modelRecordCount ?? 0) * 48
  );
}
