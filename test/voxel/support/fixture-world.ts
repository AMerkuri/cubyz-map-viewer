import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

import type { BlockColorTable } from "../../../src/server/services/block-color-table.js";
import type { BlockShapeTable } from "../../../src/server/services/block-shape-table.js";

export const REGION_SIZE = 128;
export const CHUNK_SIZE = 32;
export const EMITTER_CAP = 8192;
export const EMITTER_RADIUS = 12;
export const STONE = 1;
export const EMITTER = 2;
export const TRANSPARENT = 3;
export const MODEL = 4;
export const LOD1_EMITTER = 5;
export const SEMANTIC = 6;

export type Point = { x: number; y: number; z: number };
export type Cell = Point & { type: number };
export type BoundaryFixture = {
  name: string;
  halo: Point[];
  receivers: Point[];
  extra?: Cell[];
  denseNeighbor?: boolean;
};
export type AdjacentYAxisFixture = {
  crossBoundary: Point;
  southUnrelated: Point[];
  northUnrelated: Point[];
};

export const colors: BlockColorTable = {
  rgb: new Uint8Array([
    0, 0, 0, 100, 100, 100, 255, 80, 20, 80, 120, 180, 180, 120, 80, 255, 160,
    40, 80, 255, 120,
  ]),
  emittedLightRgb: new Uint8Array([
    0, 0, 0, 0, 0, 0, 255, 80, 20, 0, 0, 0, 120, 200, 255, 40, 220, 80, 0, 0, 0,
  ]),
  airLike: new Uint8Array([1, 0, 0, 0, 0, 0, 0]),
  renderKind: new Uint8Array([0, 1, 1, 2, 1, 1, 1]),
  transparentBackface: new Uint8Array(7),
  transparentGroup: new Uint32Array(7),
  signature: "voxel-test-colors-v1",
};

export const shapes: BlockShapeTable = {
  shapes: [
    { kind: "air", fallback: "air" },
    { kind: "cube", fallback: "cube" },
    { kind: "cube", fallback: "cube" },
    { kind: "cube", fallback: "cube" },
    {
      kind: "model",
      fallback: "cube",
      blockId: "fixture:model",
      modelRef: "fixture:model",
      sideModelRef: null,
      rotation: "cubyz:no_rotation",
      lodReplacement: null,
      quads: [],
      sideQuads: [],
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
    },
    {
      kind: "model",
      fallback: "air",
      blockId: "fixture:lod1-emitter",
      modelRef: "fixture:lod1-emitter",
      sideModelRef: null,
      rotation: "cubyz:no_rotation",
      lodReplacement: null,
      quads: [
        {
          vertices: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 1, y: 0, z: 1 },
            { x: 0, y: 0, z: 1 },
          ],
          normal: { x: 0, y: -1, z: 0 },
        },
      ],
      sideQuads: [],
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
    },
    {
      kind: "semantic",
      fallback: "air",
      blockId: "fixture:stairs",
      semantic: "cubyz:stairs",
      lodReplacement: null,
      modelRefs: {},
      quads: [],
      variantQuads: {},
      radius: null,
      states: null,
    },
  ],
  signature: "voxel-test-shapes-v1",
};

export const boundaryFixtures: BoundaryFixture[] = [
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

export async function withTemporarySave<T>(
  name: string,
  run: (save: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), `cubyz-voxel-${name}-`));
  try {
    return await run(join(root, "save"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function writeBoundaryFixture(
  save: string,
  fixture: BoundaryFixture,
  pressure: boolean,
): Promise<Point[]> {
  const cells = stonePlane();
  if (pressure) {
    for (let x = 0; x < REGION_SIZE; x++)
      for (let y = 0; y < REGION_SIZE; y++)
        if ((x + y) % 2 === 0) cells.push({ x, y, z: 1, type: EMITTER });
  } else cells.push({ x: 64, y: 64, z: 1, type: EMITTER });
  const halo = [...fixture.halo];
  if (fixture.denseNeighbor)
    for (let y = 0; y < REGION_SIZE; y += 2)
      for (let z = 1; z <= 12; z++) halo.push({ x: -1, y, z });
  cells.push(
    ...halo.map((point) => ({ ...point, type: EMITTER })),
    ...(fixture.extra ?? []),
  );
  await writeSurface(save);
  await writeRegions(save, cells);
  return [
    ...new Map(halo.map((point) => [pointKey(point), point])).values(),
  ].sort(comparePoints);
}

export async function writeAdjacentFixture(
  save: string,
  pressure: boolean,
): Promise<Point[]> {
  const cells: Cell[] = [];
  for (let x = 0; x < REGION_SIZE * 2; x++)
    for (let y = 0; y < REGION_SIZE; y++) {
      cells.push({ x, y, z: 0, type: STONE });
      const localX = x % REGION_SIZE;
      if (
        pressure &&
        (x < REGION_SIZE ? localX < REGION_SIZE / 2 : localX >= REGION_SIZE / 2)
      )
        cells.push({ x, y, z: 1, type: EMITTER });
    }
  const required = [
    { x: REGION_SIZE + 1, y: 62, z: 2 },
    { x: REGION_SIZE + 1, y: 66, z: 2 },
  ];
  const distractors: Point[] = [];
  for (let y = 0; y < REGION_SIZE; y += 2)
    for (let z = 3; z <= 11; z += 2)
      if (Math.abs(y - 64) >= EMITTER_RADIUS)
        distractors.push({ x: REGION_SIZE + 1, y, z });
  cells.push(
    ...[...required, ...distractors].map((point) => ({
      ...point,
      type: EMITTER,
    })),
  );
  await writeSurface(save);
  await writeRegions(save, cells);
  return required;
}

export async function writeAdjacentYAxisFixture(
  save: string,
): Promise<AdjacentYAxisFixture> {
  const fixture: AdjacentYAxisFixture = {
    crossBoundary: { x: 64, y: REGION_SIZE + 1, z: 1 },
    southUnrelated: [{ x: 16, y: 16, z: 1 }],
    northUnrelated: [
      { x: 16, y: REGION_SIZE + 96, z: 1 },
      { x: 96, y: REGION_SIZE + 112, z: 1 },
    ],
  };
  await writeSurface(save);
  await writeRegions(save, [
    ...stonePlane(REGION_SIZE, REGION_SIZE * 2),
    ...[
      fixture.crossBoundary,
      ...fixture.southUnrelated,
      ...fixture.northUnrelated,
    ].map((point) => ({ ...point, type: EMITTER })),
  ]);
  return fixture;
}

export async function writePopulatedEmitterFixture(
  save: string,
): Promise<void> {
  await writeSurface(save);
  await writeRegions(save, [
    ...stonePlane(),
    { x: 40, y: 40, z: 1, type: EMITTER },
    { x: 41, y: 40, z: 1, type: TRANSPARENT },
    { x: 39, y: 40, z: 1, type: MODEL },
    { x: 40, y: 41, z: 1, type: packBlock(SEMANTIC, 1) },
    { x: 40, y: 39, z: 1, type: STONE },
    { x: 64, y: 64, z: 1, type: LOD1_EMITTER },
    { x: 0, y: 72, z: 1, type: EMITTER },
    { x: 80, y: 80, z: -64, type: EMITTER },
  ]);
}

export async function writeEmptyEmitterFixture(save: string): Promise<void> {
  await writeSurface(save);
  await writeRegions(save, stonePlane());
}

export function stonePlane(
  width = REGION_SIZE,
  height = REGION_SIZE,
  lod = 1,
): Cell[] {
  const cells: Cell[] = [];
  for (let x = 0; x < width; x += lod)
    for (let y = 0; y < height; y += lod)
      cells.push({ x, y, z: 0, type: STONE });
  return cells;
}

export async function writeSurface(save: string, lod = 1): Promise<void> {
  const data = Buffer.alloc(256 * 256 * 12);
  for (let index = 0; index < 256 * 256; index++) {
    data.writeInt32BE(1, 256 * 256 * 4 + index * 4);
    data.writeInt32BE(1, 256 * 256 * 8 + index * 4);
  }
  const payload = Buffer.concat([Buffer.from([1, 0]), deflateRawSync(data)]);
  for (const x of [-256, 0, 256]) {
    const directory = join(save, "maps", String(lod), String(x * lod));
    await mkdir(directory, { recursive: true });
    for (const y of [-256, 0, 256])
      await writeFile(join(directory, `${y * lod}.surface`), payload);
  }
}

export async function writeRegions(
  save: string,
  cells: Cell[],
  lod = 1,
): Promise<void> {
  const regions = new Map<string, Map<number, Uint32Array>>();
  for (const cell of cells) {
    const regionSpan = REGION_SIZE * lod;
    const chunkSpan = CHUNK_SIZE * lod;
    const regionX = Math.floor(cell.x / regionSpan) * regionSpan;
    const regionY = Math.floor(cell.y / regionSpan) * regionSpan;
    const regionZ = Math.floor(cell.z / regionSpan) * regionSpan;
    const chunkIndex =
      Math.floor((cell.x - regionX) / chunkSpan) * 16 +
      Math.floor((cell.y - regionY) / chunkSpan) * 4 +
      Math.floor((cell.z - regionZ) / chunkSpan);
    const key = `${regionX}/${regionY}/${regionZ}`;
    const chunks = regions.get(key) ?? new Map<number, Uint32Array>();
    regions.set(key, chunks);
    const blocks = chunks.get(chunkIndex) ?? new Uint32Array(CHUNK_SIZE ** 3);
    chunks.set(chunkIndex, blocks);
    const lx = Math.floor(
      (((cell.x / lod) % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
    );
    const ly = Math.floor(
      (((cell.y / lod) % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
    );
    const lz = Math.floor(
      (((cell.z / lod) % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
    );
    blocks[lx * CHUNK_SIZE * CHUNK_SIZE + ly * CHUNK_SIZE + lz] = cell.type;
  }
  for (const [key, chunks] of regions) {
    const [x, y, z] = key.split("/").map(Number) as [number, number, number];
    const payloads = new Map<number, Buffer>();
    for (const [index, blocks] of chunks) {
      const raw = Buffer.alloc(blocks.byteLength);
      for (let block = 0; block < blocks.length; block++)
        raw.writeUInt32BE(blocks[block] ?? 0, block * 4);
      payloads.set(index, Buffer.concat([u32(1), deflateRawSync(raw)]));
    }
    const header = Buffer.alloc(8 + 64 * 4);
    header.writeUInt32BE(0, 0);
    header.writeUInt32BE(
      header.length +
        [...payloads.values()].reduce(
          (sum, payload) => sum + payload.length,
          0,
        ),
      4,
    );
    for (const [index, payload] of payloads)
      header.writeUInt32BE(payload.length, 8 + index * 4);
    const directory = join(save, "chunks", String(lod), String(x), String(y));
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, `${z}.region`),
      Buffer.concat([
        header,
        ...[...payloads]
          .sort(([a], [b]) => a - b)
          .map(([, payload]) => payload),
      ]),
    );
  }
}

export function pointKey(point: Point): string {
  return `${point.x}/${point.y}/${point.z}`;
}
export function comparePoints(a: Point, b: Point): number {
  return a.x - b.x || a.y - b.y || a.z - b.z;
}
export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function packBlock(type: number, data: number): number {
  return type | (data << 16);
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}
