import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, get as httpGet } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST = join(
  ROOT,
  "test",
  "voxel",
  "benchmarks",
  "real-save-workload.json",
);
const SUPPORTED_LODS = new Set([1, 2, 4, 8, 16, 32]);
const MEMORY_ENV_KEYS = [
  "VOXEL_MEMORY_CACHE_SIZE",
  "VOXEL_MEMORY_CACHE_BYTES",
  "VOXEL_EMITTER_SUMMARY_CACHE_SIZE",
  "VOXEL_EMITTER_SUMMARY_CACHE_BYTES",
  "VOXEL_WORKER_EMITTER_CACHE_SIZE",
  "VOXEL_WORKER_EMITTER_CACHE_SOURCES",
  "VOXEL_QUEUE_LIMIT",
  "VOXEL_WORKER_RECYCLE_HEAP_BYTES",
  "VOXEL_WORKER_RECYCLE_EXTERNAL_BYTES",
  "VOXEL_WORKER_RECYCLE_ARRAY_BUFFER_BYTES",
  "VOXEL_WORKER_RECYCLE_JOBS",
];

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

await requireDirectory(options.save, "--save");
await requireDirectory(options.cubyz, "--cubyz");
const manifestText = await readFile(options.manifest, "utf8");
const manifest = JSON.parse(manifestText);
validateManifest(manifest);

const worldMetadata = await readFile(join(options.save, "world.zig.zon"));
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  observational: true,
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    serverMode: options.runtime,
  },
  save: {
    path: options.save,
    worldMetadataSha256: sha256(worldMetadata),
  },
  manifest: {
    path: options.manifest,
    sha256: sha256(manifestText),
    contents: manifest,
  },
  workload: {
    concurrency: options.concurrency,
    encoding: options.encoding,
    sampleMs: options.sampleMs,
    idleMs: options.idleMs,
  },
  runs: [],
};

for (const workers of options.workers) {
  result.runs.push(await runConfiguration(workers));
}
result.payloadEquivalence = comparePayloads(result.runs);

await writeFile(options.json, `${JSON.stringify(result, null, 2)}\n`);
printTable(result.runs);
console.log(`\nJSON: ${options.json}`);

async function runConfiguration(workers) {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), `cubyz-voxel-memory-${workers}-`),
  );
  const port = await availablePort();
  const samples = [];
  let phase = "startup";
  let sampler;
  let child;
  const output = [];
  try {
    const childEnv = { ...process.env };
    delete childEnv.SAVE_PATH;
    delete childEnv.CUBYZ_PATH;
    Object.assign(childEnv, {
      HOST: "127.0.0.1",
      PORT: String(port),
      LOG_DIR: join(temporaryRoot, "logs"),
      VOXEL_CACHE_DIR: join(temporaryRoot, "cache"),
      VOXEL_PREGENERATE_ON_STARTUP: "false",
      VOXEL_WORKERS: String(workers),
    });
    const command = options.runtime === "dist" ? [] : ["--import", "tsx"];
    command.push(
      options.runtime === "dist"
        ? join(ROOT, "dist", "server", "index.js")
        : join(ROOT, "src", "server", "index.ts"),
      "--save",
      options.save,
      "--cubyz",
      options.cubyz,
    );
    child = spawn(process.execPath, command, {
      cwd: ROOT,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        output.push(chunk);
        if (output.length > 200) output.shift();
      });
    }
    const sample = async () => {
      const rssBytes = await readRss(child.pid);
      if (rssBytes !== null) {
        samples.push({ atMs: performance.now(), phase, rssBytes });
      }
    };
    await sample();
    sampler = setInterval(() => void sample(), options.sampleMs);
    const health = await waitForHealth(port, child, output);
    await sample();
    const startupSamples = samples.filter((entry) => entry.phase === "startup");
    const run = {
      workers,
      configuration: Object.fromEntries(
        MEMORY_ENV_KEYS.map((key) => [key, childEnv[key] ?? null]),
      ),
      health,
      startup: {
        readyRssBytes: lastRss(startupSamples),
        peakRssBytes: peakRss(startupSamples),
      },
    };
    for (const phaseName of ["cold", "warm"]) {
      phase = phaseName;
      run[phaseName] = await runPhase(port, child.pid, phaseName, samples);
    }
    return run;
  } finally {
    if (sampler) clearInterval(sampler);
    if (child) await stopChild(child);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function runPhase(port, pid, phaseName, samples) {
  const metricsBefore = await requestJson(port, "/api/voxels/metrics");
  const sampleStart = samples.length;
  const startedAt = performance.now();
  const responses = await runBounded(
    manifest.requests,
    options.concurrency,
    (request) => requestVoxel(port, request, options.encoding),
  );
  const durationMs = performance.now() - startedAt;
  const postWorkRssBytes = (await readRss(pid)) ?? lastRss(samples);
  const metricsAfterWork = await requestJson(port, "/api/voxels/metrics");
  const workSamples = samples.slice(sampleStart);
  await delay(options.idleMs);
  const postIdleRssBytes = (await readRss(pid)) ?? lastRss(samples);
  const metricsAfterIdle = await requestJson(port, "/api/voxels/metrics");
  const outcomes = {};
  for (const response of responses) {
    outcomes[response.status] = (outcomes[response.status] ?? 0) + 1;
  }
  return {
    phase: phaseName,
    durationMs,
    requests: responses.length,
    outcomes,
    wireBytes: responses.reduce((sum, response) => sum + response.wireBytes, 0),
    requestLatencyMs: summarizeLatency(
      responses.map((response) => response.durationMs),
    ),
    payloads: responses.map(
      ({ lod, regionX, regionY, status, wireBytes, bodySha256 }) => ({
        lod,
        regionX,
        regionY,
        status,
        wireBytes,
        bodySha256,
      }),
    ),
    rss: {
      peakRssBytes: peakRss([...workSamples, { rssBytes: postWorkRssBytes }]),
      postWorkRssBytes,
      postIdleRssBytes,
    },
    metricsBefore,
    metricsAfterWork,
    metricsAfterIdle,
    metricDeltas: numericDelta(metricsBefore, metricsAfterWork),
  };
}

async function requestVoxel(port, request, encoding) {
  const startedAt = performance.now();
  return requestRaw(
    port,
    `/api/voxels/${request.lod}/${request.regionX}/${request.regionY}`,
    { "accept-encoding": encoding },
    false,
  ).then(({ status, headers, wireBytes, bodySha256 }) => {
    if (status !== 200 && status !== 204) {
      throw new Error(`Voxel request returned HTTP ${status}`);
    }
    if (status === 200 && headers["content-encoding"] !== encoding) {
      throw new Error(`Voxel request did not return ${encoding} encoding`);
    }
    return {
      ...request,
      status,
      wireBytes,
      bodySha256,
      durationMs: performance.now() - startedAt,
    };
  });
}

function requestRaw(port, path, headers = {}, collectBody = true) {
  return new Promise((resolveRequest, reject) => {
    const request = httpGet(
      { host: "127.0.0.1", port, path, headers },
      async (response) => {
        try {
          let wireBytes = 0;
          const chunks = [];
          const bodyHash = createHash("sha256");
          for await (const chunk of response) {
            wireBytes += chunk.byteLength;
            bodyHash.update(chunk);
            if (collectBody) chunks.push(chunk);
          }
          resolveRequest({
            status: response.statusCode ?? 0,
            headers: response.headers,
            wireBytes,
            bodySha256: bodyHash.digest("hex"),
            body: collectBody ? Buffer.concat(chunks).toString("utf8") : "",
          });
        } catch (error) {
          reject(error);
        }
      },
    );
    request.on("error", reject);
  });
}

function summarizeLatency(values) {
  const sorted = values.toSorted((left, right) => left - right);
  const percentile = (fraction) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    0;
  return {
    min: sorted[0] ?? 0,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1) ?? 0,
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

function comparePayloads(runs) {
  const phases = runs.flatMap((run) =>
    [run.cold, run.warm].map((phase) => ({
      workers: run.workers,
      phase: phase.phase,
      payloads: phase.payloads,
    })),
  );
  const baseline = phases[0];
  if (!baseline) return { equivalent: true, comparedPhases: 0, mismatches: [] };
  const mismatches = [];
  for (const candidate of phases.slice(1)) {
    for (let index = 0; index < baseline.payloads.length; index++) {
      const expected = baseline.payloads[index];
      const actual = candidate.payloads[index];
      if (
        expected?.status === actual?.status &&
        expected?.bodySha256 === actual?.bodySha256
      )
        continue;
      mismatches.push({
        workers: candidate.workers,
        phase: candidate.phase,
        lod: expected?.lod,
        regionX: expected?.regionX,
        regionY: expected?.regionY,
        expectedStatus: expected?.status,
        actualStatus: actual?.status,
        expectedSha256: expected?.bodySha256,
        actualSha256: actual?.bodySha256,
      });
    }
  }
  return {
    equivalent: mismatches.length === 0,
    comparedPhases: phases.length,
    requestsPerPhase: baseline.payloads.length,
    mismatches,
  };
}

async function requestJson(port, path) {
  const response = await requestRaw(port, path);
  if (response.status !== 200) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return JSON.parse(response.body);
}

async function waitForHealth(port, child, output) {
  const deadline = Date.now() + options.startupTimeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited during startup:\n${output.join("")}`);
    }
    try {
      const health = await requestJson(port, "/api/health");
      if (health.status === "ok") return health;
    } catch {}
    await delay(100);
  }
  throw new Error(`Server readiness timed out:\n${output.join("")}`);
}

async function runBounded(values, concurrency, run) {
  const results = new Array(values.length);
  let next = 0;
  async function runner() {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await run(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, runner),
  );
  return results;
}

async function readRss(pid) {
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
    return match ? Number(match[1]) * 1024 : null;
  } catch {
    return null;
  }
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  const timedOut = await Promise.race([
    exited.then(() => false),
    delay(5000).then(() => true),
  ]);
  if (timedOut && child.exitCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  if (!address || typeof address === "string") throw new Error("No free port");
  return address.port;
}

function peakRss(samples) {
  return samples.reduce((peak, sample) => Math.max(peak, sample.rssBytes), 0);
}

function lastRss(samples) {
  return samples.at(-1)?.rssBytes ?? 0;
}

function numericDelta(before, after) {
  return Object.fromEntries(
    Object.keys(after)
      .filter(
        (key) =>
          typeof after[key] === "number" && typeof before[key] === "number",
      )
      .map((key) => [key, after[key] - before[key]]),
  );
}

function validateManifest(value) {
  if (
    value?.version !== 1 ||
    !Array.isArray(value.requests) ||
    !value.requests.length
  ) {
    throw new Error(
      "Manifest must have version 1 and a non-empty requests array",
    );
  }
  const seen = new Set();
  for (const request of value.requests) {
    const { lod, regionX, regionY } = request;
    const alignment = 128 * lod;
    if (
      !SUPPORTED_LODS.has(lod) ||
      !Number.isSafeInteger(regionX) ||
      !Number.isSafeInteger(regionY) ||
      regionX % alignment !== 0 ||
      regionY % alignment !== 0
    ) {
      throw new Error(
        `Invalid or unaligned manifest request: ${JSON.stringify(request)}`,
      );
    }
    const key = `${lod}/${regionX}/${regionY}`;
    if (seen.has(key)) throw new Error(`Duplicate manifest request: ${key}`);
    seen.add(key);
  }
}

function parseArgs(args) {
  const parsed = {
    manifest: DEFAULT_MANIFEST,
    workers: [1, 8],
    concurrency: 8,
    encoding: "br",
    sampleMs: 100,
    idleMs: 30_000,
    startupTimeoutMs: 120_000,
    runtime: "source",
  };
  for (let index = 0; index < args.length; index++) {
    const [flag, inline] = args[index].split("=", 2);
    if (flag === "--help") {
      parsed.help = true;
      continue;
    }
    const value = inline ?? args[++index];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (
      flag === "--save" ||
      flag === "--cubyz" ||
      flag === "--manifest" ||
      flag === "--json"
    ) {
      parsed[flag.slice(2)] = resolve(value);
    } else if (flag === "--workers") {
      parsed.workers = value
        .split(",")
        .map((entry) => positiveInteger(entry, flag));
    } else if (flag === "--concurrency") {
      parsed.concurrency = positiveInteger(value, flag);
    } else if (flag === "--sample-ms") {
      parsed.sampleMs = positiveInteger(value, flag);
    } else if (flag === "--idle-ms") {
      parsed.idleMs = nonNegativeInteger(value, flag);
    } else if (flag === "--startup-timeout-ms") {
      parsed.startupTimeoutMs = positiveInteger(value, flag);
    } else if (flag === "--encoding" && (value === "br" || value === "gzip")) {
      parsed.encoding = value;
    } else if (
      flag === "--runtime" &&
      (value === "source" || value === "dist")
    ) {
      parsed.runtime = value;
    } else {
      throw new Error(`Unknown or invalid argument: ${flag}`);
    }
  }
  if (!parsed.help && (!parsed.save || !parsed.cubyz || !parsed.json)) {
    throw new Error("--save, --cubyz, and --json are required");
  }
  return parsed;
}

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

async function requireDirectory(path, flag) {
  if (!(await stat(path)).isDirectory())
    throw new Error(`${flag} must be a directory`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function formatMiB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

function printTable(runs) {
  const rows = runs.flatMap((run) =>
    [run.cold, run.warm].map((phaseResult) => ({
      Workers: run.workers,
      Phase: phaseResult.phase,
      Requests: phaseResult.requests,
      200: phaseResult.outcomes[200] ?? 0,
      204: phaseResult.outcomes[204] ?? 0,
      "Time(s)": (phaseResult.durationMs / 1000).toFixed(1),
      "Startup MiB": formatMiB(run.startup.readyRssBytes),
      "Peak MiB": formatMiB(phaseResult.rss.peakRssBytes),
      "Post MiB": formatMiB(phaseResult.rss.postWorkRssBytes),
      "Idle MiB": formatMiB(phaseResult.rss.postIdleRssBytes),
      "Mesh MiB": formatMiB(phaseResult.metricsAfterIdle.cacheBytes),
      "Summary MiB": formatMiB(
        phaseResult.metricsAfterIdle.summaryCacheEstimatedBytes,
      ),
    })),
  );
  console.table(rows);
}

function printHelp() {
  console.log(
    `Usage: npm run bench:voxel:real-save -- --save PATH --cubyz PATH --json FILE [options]\n\nOptions:\n  --manifest FILE             Request manifest (default: checked-in workload)\n  --workers LIST              Comma-separated worker counts (default: 1,8)\n  --concurrency N             Concurrent HTTP requests (default: 8)\n  --encoding br|gzip          Response encoding (default: br)\n  --sample-ms N               RSS sample interval (default: 100)\n  --idle-ms N                 Post-phase idle interval (default: 30000)\n  --startup-timeout-ms N      Readiness timeout (default: 120000)\n  --runtime source|dist       Server entrypoint (default: source)\n  --help                      Show this help`,
  );
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
