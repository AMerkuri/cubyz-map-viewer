import type { Point } from "./fixture-world.js";
import type { buildWithProductionWorker } from "./worker-harness.js";

type WorkerMesh = Awaited<ReturnType<typeof buildWithProductionWorker>>;
type Emissive = [number, number, number];

export function collectSeamEmissive(
  mesh: WorkerMesh,
  seamX: number,
  minY = 60,
  maxY = 68,
  seamZ = 1,
): Map<string, Emissive> {
  const values = new Map<string, Emissive>();
  for (const quadrant of mesh.quadrantMeshes) {
    if (!quadrant.emissiveColors) continue;
    const scale = quadrant.emissiveColors instanceof Uint16Array ? 65535 : 255;
    for (let index = 0; index < quadrant.positions.length; index += 3) {
      const x = quadrant.positions[index];
      const y = quadrant.positions[index + 1];
      const z = quadrant.positions[index + 2];
      if (
        x !== seamX ||
        y < minY ||
        y > maxY ||
        z !== seamZ ||
        quadrant.normals[index] !== 0 ||
        quadrant.normals[index + 1] !== 0 ||
        quadrant.normals[index + 2] !== 1
      )
        continue;
      values.set(`${x}/${y}/${z}/0/0/1`, [
        (quadrant.emissiveColors[index] ?? 0) / scale,
        (quadrant.emissiveColors[index + 1] ?? 0) / scale,
        (quadrant.emissiveColors[index + 2] ?? 0) / scale,
      ]);
    }
  }
  return values;
}

export function maxSeamDelta(
  left: Map<string, Emissive>,
  right: Map<string, Emissive>,
): { count: number; delta: number } {
  let delta = 0;
  let count = 0;
  for (const [key, color] of left) {
    const other = right.get(key);
    if (!other) continue;
    count++;
    delta = Math.max(
      delta,
      Math.abs(color[0] - other[0]),
      Math.abs(color[1] - other[1]),
      Math.abs(color[2] - other[2]),
    );
  }
  return { count, delta };
}

export function hasLightAt(
  records: {
    x: number;
    y: number;
    z: number;
    r: number;
    g: number;
    b: number;
    openFaces: number;
  }[],
  receiver: Point,
  radius = 12,
): boolean {
  return records.some(
    (record) =>
      Math.hypot(
        receiver.x - record.x,
        receiver.y - record.y,
        receiver.z - record.z,
      ) < radius && Math.max(record.r, record.g, record.b) > 0,
  );
}
