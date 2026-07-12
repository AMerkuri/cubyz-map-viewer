import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

import type { BlockColorTable } from "../src/server/services/block-color-table.js";
import type { BlockShapeTable } from "../src/server/services/block-shape-table.js";
import type {
  EmitterSummaryCluster,
  EmitterSummaryNode,
} from "../src/server/services/voxel-emitter-aggregation.js";
import { VoxelEmitterSummaryService } from "../src/server/services/voxel-emitter-summary-service.js";
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
type WorkerMesh = ReturnType<
  typeof import("../src/client/features/world-view/workers/voxel-mesh.worker.js").buildMeshArrays
>;

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
    0, 0, 0, 100, 100, 100, 255, 80, 20, 80, 120, 180, 180, 120, 80, 255, 160,
    40,
  ]),
  emittedLightRgb: new Uint8Array([
    0, 0, 0, 0, 0, 0, 255, 80, 20, 0, 0, 0, 120, 200, 255, 255, 160, 40,
  ]),
  airLike: new Uint8Array([1, 0, 0, 0, 0, 0]),
  renderKind: new Uint8Array([0, 1, 1, 2, 1, 1]),
  transparentBackface: new Uint8Array(6),
  transparentGroup: new Uint32Array(6),
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
    { kind: "cube", fallback: "solid" },
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
    outcomes.push(...(await validateAdjacentCapPressure(root)));
    outcomes.push(await validateCoarseAdjacent(root));
    outcomes.push(await validateUnrepresentedSources(root));
    outcomes.push(await validateQualifiedCoarseSource(root));
    console.log(`Voxel seam validation passed (${outcomes.length} runs).`);
    for (const outcome of outcomes) console.log(`  ${outcome}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function validateQualifiedCoarseSource(root: string): Promise<string> {
  const save = join(root, "qualified-coarse-source");
  await writeSurface(save);
  const detailedCells: Cell[] = [{ x: 64, y: 64, z: 1, type: EMITTER }];
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      detailedCells.push({ x, y, z: 0, type: STONE });
    }
  }
  await writeRegions(save, detailedCells);
  await writeSurface(save, 2);
  const coarseCells: Cell[] = [];
  for (let x = 0; x < SIZE * 2; x += 2) {
    for (let y = 0; y < SIZE * 2; y += 2) {
      coarseCells.push({ x, y, z: 0, type: STONE });
    }
  }
  await writeRegions(save, coarseCells, 2);
  const detailed = await generateVoxelMesh(save, colors, shapes, 1, 0, 0, {
    includeHaloEmitters: false,
    returnRepresentedSources: true,
  });
  assert.equal(
    detailed.representedSources?.length,
    1,
    "coarse fixture source was not represented at LOD1",
  );
  const service = new VoxelEmitterSummaryService(save, colors, shapes);
  const summary = await service.getNode(2, 0, 0);
  assert.equal(
    summary.node.clusters.length > 0,
    true,
    "qualified source was removed from the LOD2 summary",
  );
  const coarse = await generateVoxelMesh(save, colors, shapes, 2, 0, 0, {
    emitterSummary: summary.node,
    emitterSummaryMetrics: summary.metrics,
    includeHaloEmitters: false,
  });
  assert(coarse.buffer, "air-replaced coarse fixture produced no mesh");
  assert.equal(
    decodeRecords(coarse.buffer).length > 0,
    true,
    "qualified source did not illuminate coarse receiving geometry",
  );
  return "qualified-coarse-source: LOD1 source retained near LOD2 receiving geometry";
}

async function validateUnrepresentedSources(root: string): Promise<string> {
  const save = join(root, "unrepresented-sources");
  const hidden = { x: 32, y: 32, z: 0 };
  const depthSuppressed = { x: 48, y: 48, z: -70 };
  const emptyModel = { x: 64, y: 64, z: 1 };
  await writeSurface(save);
  await writeRegions(save, [
    { ...hidden, type: EMITTER },
    { x: 31, y: 32, z: 0, type: STONE },
    { x: 33, y: 32, z: 0, type: STONE },
    { x: 32, y: 31, z: 0, type: STONE },
    { x: 32, y: 33, z: 0, type: STONE },
    { x: 32, y: 32, z: -1, type: STONE },
    { x: 32, y: 32, z: 1, type: STONE },
    { ...depthSuppressed, type: EMITTER },
    { ...emptyModel, type: MODEL },
    { x: 0, y: 0, z: 0, type: STONE },
  ]);
  const result = await generateVoxelMesh(save, colors, shapes, 1, 0, 0, {
    includeHaloEmitters: false,
    returnRepresentedSources: true,
  });
  assert(result.buffer, "unrepresented-source fixture produced no mesh");
  assert.deepEqual(
    result.representedSources,
    [],
    "hidden, depth-suppressed, or empty-model sources became represented",
  );
  assert.equal(
    decodeRecords(result.buffer).length,
    0,
    "unrepresented sources produced payload emitter records",
  );
  const workerMesh = await buildWithProductionWorker(result.buffer.slice(0));
  assert.equal(
    workerMesh.emitterRecords.length,
    0,
    "unrepresented sources produced runtime accent ownership",
  );
  return "unrepresented-sources: hidden, depth-suppressed, and empty-model emitters omitted";
}

async function validateCoarseAdjacent(root: string): Promise<string> {
  const save = join(root, "adjacent-worker-lod2");
  const lod = 2;
  const span = SIZE * lod;
  const cells: Cell[] = [];
  for (let x = 0; x < span * 2; x += lod) {
    for (let y = 0; y < span; y += lod) {
      cells.push({ x, y, z: 0, type: STONE });
    }
  }
  await writeSurface(save, lod);
  await writeRegions(save, cells, lod);
  const clusters = [
    createSummaryCluster(span - 6, 128, 5, 220, 80, 20),
    createSummaryCluster(span + 6, 132, 5, 20, 100, 255),
  ];
  const west = await generateCoarse(save, lod, 0, 0, clusters);
  const east = await generateCoarse(save, lod, span, 0, clusters);
  const [westMesh, eastMesh] = await Promise.all([
    buildWithProductionWorker(west.buffer.slice(0)),
    buildWithProductionWorker(east.buffer.slice(0)),
  ]);
  const westSeam = collectSeamEmissive(westMesh, span, 0, span, lod);
  const eastSeam = collectSeamEmissive(eastMesh, span, 0, span, lod);
  const sharedKeys = [...westSeam.keys()].filter((key) => eastSeam.has(key));
  assert(
    sharedKeys.length > 0,
    "LOD2 fixture produced no matching seam vertices",
  );
  let maxDelta = 0;
  for (const key of sharedKeys) {
    const westColor = westSeam.get(key);
    const eastColor = eastSeam.get(key);
    if (!westColor || !eastColor) continue;
    maxDelta = Math.max(
      maxDelta,
      Math.abs(westColor[0] - eastColor[0]),
      Math.abs(westColor[1] - eastColor[1]),
      Math.abs(westColor[2] - eastColor[2]),
    );
  }
  assert(
    maxDelta <= 1 / 255,
    `LOD2 worker-baked seam delta ${maxDelta.toFixed(6)} exceeds encoding tolerance`,
  );
  return `adjacent-worker/lod2-coarse-halo: ${sharedKeys.length} matched seam vertices, 2 cross-boundary representatives, max delta ${maxDelta.toFixed(6)}`;
}

async function generateCoarse(
  save: string,
  lod: number,
  regionX: number,
  regionY: number,
  clusters: EmitterSummaryCluster[],
): Promise<{ buffer: ArrayBuffer }> {
  const emitterSummary: EmitterSummaryNode = {
    formatVersion: 1,
    lod: 2,
    regionX,
    regionY,
    sourceSignature: "coarse-seam-fixture",
    signature: `coarse-seam-fixture-${regionX}-${regionY}`,
    rawSourceCount: clusters.length,
    cappedClusterCount: 0,
    clusters,
  };
  const result = await generateVoxelMesh(
    save,
    colors,
    shapes,
    lod,
    regionX,
    regionY,
    { emitterSummary },
  );
  assert(result.buffer, "LOD2 fixture produced no mesh");
  return { buffer: result.buffer };
}

function createSummaryCluster(
  centroidX: number,
  centroidY: number,
  centroidZ: number,
  powerR: number,
  powerG: number,
  powerB: number,
): EmitterSummaryCluster {
  return {
    powerR,
    powerG,
    powerB,
    centroidX,
    centroidY,
    centroidZ,
    centroidWeight: 1,
    sourceCount: 1,
    openFaces: 0b11_1111,
    minX: centroidX - 0.5,
    minY: centroidY - 0.5,
    minZ: centroidZ - 0.5,
    maxX: centroidX + 0.5,
    maxY: centroidY + 0.5,
    maxZ: centroidZ + 0.5,
  };
}

async function generate(
  save: string,
  regionX = 0,
  regionY = 0,
): Promise<{ records: Record[]; bytes: Uint8Array }> {
  const result = await generateVoxelMesh(
    save,
    colors,
    shapes,
    1,
    regionX,
    regionY,
    {
      includeHaloEmitters: true,
    },
  );
  assert(result.buffer, "fixture produced no mesh");
  return {
    records: decodeRecords(result.buffer),
    bytes: new Uint8Array(result.buffer),
  };
}

async function validateAdjacentCapPressure(root: string): Promise<string[]> {
  const outcomes: string[] = [];
  for (const pressure of [false, true]) {
    const save = join(
      root,
      `adjacent-worker-${pressure ? "capped" : "uncapped"}`,
    );
    const requiredSources = await writeAdjacentFixture(save, pressure);
    const west = await generate(save, 0, 0);
    const east = await generate(save, SIZE, 0);
    const westRecords = west.records.map((record) => ({ ...record }));
    const eastRecords = east.records.map((record) => ({
      ...record,
      x: record.x + SIZE,
    }));
    for (const source of requiredSources) {
      assert(
        westRecords.some((record) => samePoint(record, source)),
        `adjacent ${pressure ? "capped" : "uncapped"}: west payload omitted required seam source ${positionKey(source)}`,
      );
      assert(
        eastRecords.some((record) => samePoint(record, source)),
        `adjacent ${pressure ? "capped" : "uncapped"}: east payload omitted required seam source ${positionKey(source)}`,
      );
    }

    const [westMesh, eastMesh] = await Promise.all([
      buildWithProductionWorker(west.bytes.buffer.slice(0)),
      buildWithProductionWorker(east.bytes.buffer.slice(0)),
    ]);
    const westSeam = collectSeamEmissive(westMesh, SIZE);
    const eastSeam = collectSeamEmissive(eastMesh, SIZE);
    const sharedKeys = [...westSeam.keys()].filter((key) => eastSeam.has(key));
    assert(
      sharedKeys.length > 0,
      "adjacent fixture produced no matching seam vertices",
    );
    let maxDelta = 0;
    let maxKey = "";
    for (const key of sharedKeys) {
      const westColor = westSeam.get(key);
      const eastColor = eastSeam.get(key);
      if (!westColor || !eastColor) continue;
      const delta = Math.max(
        Math.abs(westColor[0] - eastColor[0]),
        Math.abs(westColor[1] - eastColor[1]),
        Math.abs(westColor[2] - eastColor[2]),
      );
      if (delta > maxDelta) {
        maxDelta = delta;
        maxKey = key;
      }
    }
    const tolerance = 1 / 255;
    assert(
      maxDelta <= tolerance,
      `adjacent ${pressure ? "capped" : "uncapped"}: worker-baked seam delta ${maxDelta.toFixed(6)} exceeds ${tolerance.toFixed(6)} at ${maxKey}`,
    );
    outcomes.push(
      `adjacent-worker/${pressure ? "cap-pressure" : "uncapped"}: ${sharedKeys.length} matched seam vertices, ${requiredSources.length} required sources, max delta ${maxDelta.toFixed(6)}`,
    );
  }
  return outcomes;
}

async function writeAdjacentFixture(
  save: string,
  pressure: boolean,
): Promise<Point[]> {
  const cells: Cell[] = [];
  for (let x = 0; x < SIZE * 2; x++) {
    for (let y = 0; y < SIZE; y++) {
      cells.push({ x, y, z: 0, type: STONE });
      const localX = x % SIZE;
      const isFarFromSeam = x < SIZE ? localX < SIZE / 2 : localX >= SIZE / 2;
      if (pressure && isFarFromSeam) {
        cells.push({ x, y, z: 1, type: EMITTER });
      }
    }
  }
  const requiredSources = [
    { x: SIZE + 1, y: 62, z: 2 },
    { x: SIZE + 1, y: 66, z: 2 },
  ];
  const distractors: Point[] = [];
  for (let y = 0; y < SIZE; y += 2) {
    for (let z = 3; z <= 11; z += 2) {
      if (Math.abs(y - 64) < RADIUS) continue;
      distractors.push({ x: SIZE + 1, y, z });
    }
  }
  for (const point of [...requiredSources, ...distractors]) {
    cells.push({ ...point, type: EMITTER });
  }
  await writeSurface(save);
  await writeRegions(save, cells);
  return requiredSources;
}

let productionWorkerModulePromise:
  | Promise<
      typeof import("../src/client/features/world-view/workers/voxel-mesh.worker.js")
    >
  | undefined;

async function buildWithProductionWorker(
  buffer: ArrayBuffer,
): Promise<WorkerMesh> {
  if (!productionWorkerModulePromise) {
    Object.assign(globalThis, { self: globalThis });
    productionWorkerModulePromise = import(
      "../src/client/features/world-view/workers/voxel-mesh.worker.js"
    );
  }
  const worker = await productionWorkerModulePromise;
  return worker.buildMeshArrays(buffer, true);
}

function collectSeamEmissive(
  mesh: WorkerMesh,
  seamX: number,
  minY = 60,
  maxY = 68,
  seamZ = 1,
): Map<string, [number, number, number]> {
  const values = new Map<string, [number, number, number]>();
  for (const quadrant of mesh.quadrantMeshes) {
    if (!quadrant.emissiveColors) continue;
    const scale = quadrant.emissiveColors instanceof Uint16Array ? 65535 : 255;
    for (let index = 0; index < quadrant.positions.length; index += 3) {
      const x = quadrant.positions[index];
      if (x !== seamX) continue;
      const y = quadrant.positions[index + 1];
      const z = quadrant.positions[index + 2];
      if (
        y < minY ||
        y > maxY ||
        z !== seamZ ||
        quadrant.normals[index] !== 0 ||
        quadrant.normals[index + 1] !== 0 ||
        quadrant.normals[index + 2] !== 1
      ) {
        continue;
      }
      const key = [
        x,
        y,
        z,
        quadrant.normals[index],
        quadrant.normals[index + 1],
        quadrant.normals[index + 2],
      ].join("/");
      values.set(key, [
        (quadrant.emissiveColors[index] ?? 0) / scale,
        (quadrant.emissiveColors[index + 1] ?? 0) / scale,
        (quadrant.emissiveColors[index + 2] ?? 0) / scale,
      ]);
    }
  }
  return values;
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

async function writeSurface(save: string, lod = 1): Promise<void> {
  const data = Buffer.alloc(256 * 256 * 12);
  for (let i = 0; i < 256 * 256; i++) {
    data.writeInt32BE(1, 256 * 256 * 4 + i * 4);
    data.writeInt32BE(1, 256 * 256 * 8 + i * 4);
  }
  const payload = Buffer.concat([Buffer.from([1, 0]), deflateRawSync(data)]);
  for (const x of [-256, 0, 256]) {
    const path = join(save, "maps", String(lod), String(x * lod));
    await mkdir(path, { recursive: true });
    for (const y of [-256, 0, 256]) {
      await writeFile(join(path, `${y * lod}.surface`), payload);
    }
  }
}

async function writeRegions(
  save: string,
  cells: Cell[],
  lod = 1,
): Promise<void> {
  const regions = new Map<string, Map<number, Uint32Array>>();
  for (const cell of cells) {
    const regionSpan = SIZE * lod;
    const chunkSpan = CHUNK * lod;
    const regionX = Math.floor(cell.x / regionSpan) * regionSpan;
    const regionY = Math.floor(cell.y / regionSpan) * regionSpan;
    const regionZ = Math.floor(cell.z / regionSpan) * regionSpan;
    const rx = Math.floor((cell.x - regionX) / chunkSpan);
    const ry = Math.floor((cell.y - regionY) / chunkSpan);
    const rz = Math.floor((cell.z - regionZ) / chunkSpan);
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
    const lx = Math.floor((((cell.x / lod) % CHUNK) + CHUNK) % CHUNK);
    const ly = Math.floor((((cell.y / lod) % CHUNK) + CHUNK) % CHUNK);
    const lz = Math.floor((((cell.z / lod) % CHUNK) + CHUNK) % CHUNK);
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
    const directory = join(save, "chunks", String(lod), String(x), String(y));
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
