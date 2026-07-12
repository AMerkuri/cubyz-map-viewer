import { performance } from "node:perf_hooks";

export type BenchmarkSummary = {
  samples: number;
  minimumMs: number;
  medianMs: number;
  p95Ms: number;
};

export async function sampleSerial(
  name: string,
  run: () => Promise<void>,
  options: { warmup?: number; iterations?: number } = {},
): Promise<BenchmarkSummary> {
  const warmup = options.warmup ?? 2;
  const iterations = options.iterations ?? 5;
  for (let index = 0; index < warmup; index++) await run();
  const samples: number[] = [];
  for (let index = 0; index < iterations; index++) {
    const start = performance.now();
    await run();
    samples.push(performance.now() - start);
  }
  samples.sort((left, right) => left - right);
  const percentile = (fraction: number) =>
    samples[
      Math.min(samples.length - 1, Math.ceil(samples.length * fraction) - 1)
    ] ?? 0;
  const summary = {
    samples: samples.length,
    minimumMs: samples[0] ?? 0,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
  };
  console.log(JSON.stringify({ benchmark: name, ...summary }));
  return summary;
}
