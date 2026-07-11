import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

import type { BlockColorTable } from "../src/server/services/block-color-table.js";
import type { BlockShapeTable } from "../src/server/services/block-shape-table.js";
import { generateVoxelMesh } from "../src/server/services/voxel-generator.js";

const SIZE = 128;
const CHUNK = 32;
const CAP = 8192;
const RADIUS = 12;
const STONE = 1;
const EMITTER = 2;
const TRANSPARENT = 3;
const MODEL = 4;
const HEADER_BYTES = 44;

type Cell = { x: number; y: number; z: number; type: number };
type Point = { x: number; y: number; z: number };
type Record = Point & {
  r: number;
  g: number;
  b: number;
  halo: boolean;
  openFaces: number;
};
type Fixture = {
  name: string;
  halo: Point[];
  receivers: Point[];
  extra?: Cell[];
  denseNeighbor?: boolean;
};

const fixtures: Fixture[] = [
  {
    name: "x-minus",
    halo: [{ x: -1, y: 64, z: 1 }],
    receivers: [{ x: 0, y: 64, z: 1 }],
  },
  {
    name: "x-plus",
    halo: [{ x: 128, y: 64, z: 1 }],
    receivers: [{ x: 127, y: 64, z: 1 }],
  },
  {
    name: "y-minus",
    halo: [{ x: 64, y: -1, z: 1 }],
    receivers: [{ x: 64, y: 0, z: 1 }],
  },
  {
    name: "y-plus",
    halo: [{ x: 64, y: 128, z: 1 }],
    receivers: [{ x: 64, y: 127, z: 1 }],
  },
  {
    name: "corner-minus",
    halo: [{ x: -1, y: -1, z: 1 }],
    receivers: [{ x: 0, y: 0, z: 1 }],
  },
  {
    name: "corner-plus",
    halo: [{ x: 128, y: 128, z: 1 }],
    receivers: [{ x: 127, y: 127, z: 1 }],
  },
  {
    name: "vertical-min",
    halo: [{ x: -1, y: 32, z: -11 }],
    receivers: [{ x: 0, y: 32, z: 0 }],
  },
  {
    name: "vertical-max",
    halo: [{ x: 128, y: 96, z: 13 }],
    receivers: [{ x: 127, y: 96, z: 2 }],
    extra: [{ x: 127, y: 96, z: 1, type: STONE }],
  },
  {
    name: "missing-special-neighbors",
    halo: [{ x: -1, y: 48, z: 1 }],
    receivers: [{ x: 0, y: 48, z: 1 }],
    extra: [
      { x: -2, y: 48, z: 1, type: TRANSPARENT },
      { x: -1, y: 49, z: 1, type: MODEL },
    ],
  },
  {
    name: "dense-both-sides",
    halo: [{ x: -1, y: 64, z: 1 }],
    receivers: [{ x: 0, y: 64, z: 1 }],
    denseNeighbor: true,
  },
];

const colors: BlockColorTable = {
  rgb: new Uint8Array([
    0, 0, 0, 100, 100, 100, 255, 80, 20, 80, 120, 180, 180, 120, 80,
  ]),
  emittedLightRgb: new Uint8Array([
    0, 0, 0, 0, 0, 0, 255, 80, 20, 0, 0, 0, 0, 0, 0,
  ]),
  airLike: new Uint8Array([1, 0, 0, 0, 0]),
  renderKind: new Uint8Array([0, 1, 1, 2, 1]),
  transparentBackface: new Uint8Array(5),
  transparentGroup: new Uint32Array(5),
  signature: "seam-fixture-colors-v1",
};
const shapes: BlockShapeTable = {
  shapes: [
    { kind: "air", fallback: "air" },
    { kind: "cube", fallback: "solid" },
    { kind: "cube", fallback: "solid" },
    { kind: "cube", fallback: "solid" },
    {
      kind: "model",
      fallback: "solid",
      blockId: "fixture:model",
      modelRef: "fixture:model",
      sideModelRef: null,
      rotation: "cubyz:no_rotation",
      lodReplacement: null,
      quads: [],
      sideQuads: [],
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
    },
  ],
  signature: "seam-fixture-shapes-v1",
};

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "cubyz-seam-validation-"));
  const outcomes: string[] = [];
  try {
    for (const fixture of fixtures) {
      for (const pressure of [false, true]) {
        const save = join(
          root,
          `${fixture.name}-${pressure ? "capped" : "uncapped"}`,
        );
        const expectedHalo = await writeFixture(save, fixture, pressure);
        const firstRun = await generate(save);
        const secondRun = await generate(save);
        const first = firstRun.records;
        assert.deepEqual(
          first,
          secondRun.records,
          `${fixture.name}: retained payload order is not deterministic`,
        );
        assert.deepEqual(
          firstRun.bytes,
          secondRun.bytes,
          `${fixture.name}: generated payload bytes are not deterministic`,
        );
        assert.equal(
          new Set(first.map(recordKey)).size,
          first.length,
          `${fixture.name}: duplicate retained record`,
        );

        const retainedHalo = first.filter((record) => record.halo);
        if (!pressure) {
          assert.equal(
            first.length,
            expectedHalo.length + 1,
            `${fixture.name}: unexpected uncapped record count`,
          );
          assert.deepEqual(
            first,
            [...first].sort(compareRecords),
            `${fixture.name}: uncapped payload order changed`,
          );
          assert.deepEqual(
            retainedHalo.map(positionKey),
            expectedHalo.map(positionKey).sort(compareKeys),
            `${fixture.name}: uncapped halo membership differs from source fixture`,
          );
        } else {
          assert.equal(
            first.length,
            CAP,
            `${fixture.name}: capped payload did not fill the cap`,
          );
          for (const source of fixture.halo) {
            assert(
              retainedHalo.some((record) => samePoint(record, source)),
              `${fixture.name}: boundary source was starved`,
            );
          }
        }

        for (const receiver of fixture.receivers) {
          assert(
            bakedLightProxy(retainedHalo, receiver) > 0,
            `${fixture.name}: receiving geometry has zero light proxy (${JSON.stringify(retainedHalo)})`,
          );
        }
        outcomes.push(
          `${fixture.name}/${pressure ? "cap-pressure" : "uncapped"}: ${first.length} records, ${retainedHalo.length} halo`,
        );
      }
    }
    console.log(`Voxel seam validation passed (${outcomes.length} runs).`);
    for (const outcome of outcomes) console.log(`  ${outcome}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function generate(
  save: string,
): Promise<{ records: Record[]; bytes: Uint8Array }> {
  const result = await generateVoxelMesh(save, colors, shapes, 1, 0, 0, {
    includeHaloEmitters: true,
  });
  assert(result.buffer, "fixture produced no mesh");
  return {
    records: decodeRecords(result.buffer),
    bytes: new Uint8Array(result.buffer),
  };
}

async function writeFixture(
  save: string,
  fixture: Fixture,
  pressure: boolean,
): Promise<Point[]> {
  const cells: Cell[] = [];
  for (let x = 0; x < SIZE; x++)
    for (let y = 0; y < SIZE; y++) cells.push({ x, y, z: 0, type: STONE });
  if (pressure) {
    for (let x = 0; x < SIZE; x++) {
      for (let y = 0; y < SIZE; y++)
        if ((x + y) % 2 === 0) cells.push({ x, y, z: 1, type: EMITTER });
    }
  } else {
    cells.push({ x: 64, y: 64, z: 1, type: EMITTER });
  }
  const halo = [...fixture.halo];
  if (fixture.denseNeighbor) {
    for (let y = 0; y < SIZE; y += 2)
      for (let z = 1; z <= 12; z++) halo.push({ x: -1, y, z });
  }
  for (const point of halo) cells.push({ ...point, type: EMITTER });
  cells.push(...(fixture.extra ?? []));
  await writeSurface(save);
  await writeRegions(save, cells);
  return [
    ...new Map(halo.map((point) => [positionKey(point), point])).values(),
  ].sort((a, b) => compareKeys(positionKey(a), positionKey(b)));
}

async function writeSurface(save: string): Promise<void> {
  const path = join(save, "maps", "1", "0");
  await mkdir(path, { recursive: true });
  const data = Buffer.alloc(256 * 256 * 12);
  for (let i = 0; i < 256 * 256; i++) {
    data.writeInt32BE(1, 256 * 256 * 4 + i * 4);
    data.writeInt32BE(1, 256 * 256 * 8 + i * 4);
  }
  await writeFile(
    join(path, "0.surface"),
    Buffer.concat([Buffer.from([1, 0]), deflateRawSync(data)]),
  );
}

async function writeRegions(save: string, cells: Cell[]): Promise<void> {
  const regions = new Map<string, Map<number, Uint32Array>>();
  for (const cell of cells) {
    const regionX = Math.floor(cell.x / SIZE) * SIZE;
    const regionY = Math.floor(cell.y / SIZE) * SIZE;
    const regionZ = Math.floor(cell.z / SIZE) * SIZE;
    const rx = Math.floor((cell.x - regionX) / CHUNK);
    const ry = Math.floor((cell.y - regionY) / CHUNK);
    const rz = Math.floor((cell.z - regionZ) / CHUNK);
    const chunkIndex = rx * 16 + ry * 4 + rz;
    const key = `${regionX}/${regionY}/${regionZ}`;
    let chunks = regions.get(key);
    if (!chunks) {
      chunks = new Map();
      regions.set(key, chunks);
    }
    let blocks = chunks.get(chunkIndex);
    if (!blocks) {
      blocks = new Uint32Array(CHUNK ** 3);
      chunks.set(chunkIndex, blocks);
    }
    const lx = ((cell.x % CHUNK) + CHUNK) % CHUNK;
    const ly = ((cell.y % CHUNK) + CHUNK) % CHUNK;
    const lz = ((cell.z % CHUNK) + CHUNK) % CHUNK;
    blocks[lx * CHUNK * CHUNK + ly * CHUNK + lz] = cell.type;
  }
  for (const [key, chunks] of regions) {
    const [x, y, z] = key.split("/").map(Number);
    const payloads = new Map<number, Buffer>();
    for (const [index, blocks] of chunks) {
      const raw = Buffer.alloc(blocks.byteLength);
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        raw.writeUInt32BE(blocks[blockIndex] ?? 0, blockIndex * 4);
      }
      payloads.set(index, Buffer.concat([u32(1), deflateRawSync(raw)]));
    }
    const header = Buffer.alloc(8 + 64 * 4);
    header.writeUInt32BE(0, 0);
    header.writeUInt32BE(
      header.length +
        [...payloads.values()].reduce((sum, item) => sum + item.length, 0),
      4,
    );
    for (const [index, payload] of payloads)
      header.writeUInt32BE(payload.length, 8 + index * 4);
    const directory = join(save, "chunks", "1", String(x), String(y));
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, `${z}.region`),
      Buffer.concat([
        header,
        ...[...payloads].sort(([a], [b]) => a - b).map(([, value]) => value),
      ]),
    );
  }
}

function decodeRecords(buffer: ArrayBuffer): Record[] {
  const view = new DataView(buffer);
  const quadCount = view.getUint32(16, true);
  const greedyCount = view.getUint32(24, true);
  const modelCount = view.getUint32(28, true);
  const emitterCount = view.getUint32(32, true);
  let offset = HEADER_BYTES;
  offset +=
    align4(quadCount * 3) +
    align4(quadCount) +
    align4(quadCount) +
    align4(quadCount * 2) +
    align4(quadCount);
  offset += greedyCount * 12 + modelCount * 48;
  const records: Record[] = [];
  for (let index = 0; index < emitterCount; index++) {
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

function bakedLightProxy(records: Record[], receiver: Point): number {
  let total = 0;
  for (const record of records) {
    const dx = receiver.x - record.x;
    const dy = receiver.y - record.y;
    const dz = receiver.z - record.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance >= RADIUS) continue;
    const t = 1 - distance / RADIUS;
    total +=
      (t *
        t *
        (3 - 2 * t) *
        directionTransmission(record.openFaces, dx, dy, dz) *
        Math.max(record.r, record.g, record.b)) /
      255;
  }
  return total;
}

function directionTransmission(
  mask: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  const ax = Math.abs(dx),
    ay = Math.abs(dy),
    az = Math.abs(dz);
  const total = ax + ay + az;
  if (total === 0) return 1;
  const x = (mask & (dx >= 0 ? 1 : 2)) !== 0 ? 1 : 0.22;
  const y = (mask & (dy >= 0 ? 4 : 8)) !== 0 ? 1 : 0.22;
  const z = (mask & (dz >= 0 ? 16 : 32)) !== 0 ? 1 : dz >= 0 ? 0.03 : 0.12;
  return (ax * x + ay * y + az * z) / total;
}

function compareRecords(a: Record, b: Record): number {
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
function recordKey(record: Record): string {
  return `${positionKey(record)}/${record.r}/${record.g}/${record.b}/${Number(record.halo)}/${record.openFaces}`;
}
function positionKey(point: Point): string {
  return `${point.x}/${point.y}/${point.z}`;
}
function compareKeys(a: string, b: string): number {
  const aa = a.split("/").map(Number);
  const bb = b.split("/").map(Number);
  return (
    (aa[0] ?? 0) - (bb[0] ?? 0) ||
    (aa[1] ?? 0) - (bb[1] ?? 0) ||
    (aa[2] ?? 0) - (bb[2] ?? 0)
  );
}
function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}
function align4(value: number): number {
  return (value + 3) & ~3;
}
function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

await main();
