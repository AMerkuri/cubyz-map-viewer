import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const savePath = resolve(process.env.SAVE_PATH ?? "");
const cubyzPath = resolve(process.env.CUBYZ_PATH ?? "");
const outputPath = resolve(
  process.env.OUTPUT_PATH ??
    join(
      root,
      "openspec/changes/bound-voxel-server-memory/browser-extreme-measurement.json",
    ),
);
const clockTicks = Number(
  spawnSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).stdout.trim(),
);
const sampleMs = 250;
const quietMs = 30_000;
const rssSafetyBytes = 6 * 1024 ** 3;
const availableSafetyBytes = 3 * 1024 ** 3;

if (!process.env.SAVE_PATH || !process.env.CUBYZ_PATH) {
  throw new Error("Set SAVE_PATH and CUBYZ_PATH");
}

const result = {
  generatedAt: new Date().toISOString(),
  preset: "extreme",
  queueLimit: 64,
  sampleMs,
  quietMs,
  rssSafetyBytes,
  runs: [],
};
const browser = await chromium.launch({ headless: true });
try {
  for (const workers of [1, 8]) {
    result.runs.push(await run(workers));
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
} finally {
  await browser.close();
}

console.table(
  result.runs.map((runResult) => ({
    Workers: runResult.workers,
    Status: runResult.status,
    "Peak RSS MiB": (runResult.peakRssBytes / 1024 ** 2).toFixed(1),
    "Peak CPU %": runResult.peakCpuPercent.toFixed(1),
    "Peak queue": runResult.peakQueueDepth,
    "Peak running": runResult.peakRunningJobs,
    Admitted: runResult.finalMetrics.admissionAccepted,
    Rejected: runResult.finalMetrics.admissionRejected,
    "Duration s": (runResult.durationMs / 1000).toFixed(1),
  })),
);
console.log(`JSON: ${outputPath}`);

async function run(workers) {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), `cubyz-browser-extreme-${workers}-`),
  );
  const port = 32_000 + workers;
  const serverOutput = [];
  const child = spawn(
    process.execPath,
    [
      join(root, "dist/server/index.js"),
      "--save",
      savePath,
      "--cubyz",
      cubyzPath,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        LOG_DIR: join(temporaryRoot, "logs"),
        VOXEL_CACHE_DIR: join(temporaryRoot, "cache"),
        VOXEL_PREGENERATE_ON_STARTUP: "false",
        VOXEL_WORKERS: String(workers),
        VOXEL_QUEUE_LIMIT: "64",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => serverOutput.push(chunk));
  }

  try {
    await waitForHealth(port, child, serverOutput);
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    await context.addInitScript(seedExtremePreset);
    const page = await context.newPage();
    const samples = [];
    let activeVoxelRequests = 0;
    let lastVoxelNetworkAt = performance.now();
    let previousProcessSample = null;
    let seenWork = false;
    let reachedQuiet = false;
    let status = "complete";
    const startedAt = performance.now();
    page.on("request", (request) => {
      if (!request.url().includes("/api/voxels/")) return;
      activeVoxelRequests++;
      lastVoxelNetworkAt = performance.now();
    });
    const finishRequest = (request) => {
      if (!request.url().includes("/api/voxels/")) return;
      activeVoxelRequests = Math.max(0, activeVoxelRequests - 1);
      lastVoxelNetworkAt = performance.now();
    };
    page.on("requestfinished", finishRequest);
    page.on("requestfailed", finishRequest);
    await page.goto(`http://127.0.0.1:${port}`, {
      waitUntil: "domcontentloaded",
    });
    const preset = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("cubyz-map-viewer.graphics-settings") ?? "null",
      ),
    );
    if (
      preset?.renderDistance !== 38400 ||
      preset?.mapDebugSettings?.maxConcurrentVoxelFetches !== 20
    ) {
      throw new Error("Extreme preset was not active before first render");
    }

    while (performance.now() - startedAt < 10 * 60_000) {
      const [processSample, metrics, availableBytes] = await Promise.all([
        readProcessSample(child.pid),
        requestJson(port, "/api/voxels/metrics"),
        readAvailableMemory(),
      ]);
      const cpuPercent = cpuSince(previousProcessSample, processSample);
      previousProcessSample = processSample;
      samples.push({
        elapsedMs: performance.now() - startedAt,
        rssBytes: processSample.rssBytes,
        cpuPercent,
        queueDepth: metrics.queueDepth,
        runningJobs: metrics.runningJobs,
        admissionAccepted: metrics.admissionAccepted,
        admissionRejected: metrics.admissionRejected,
        activeVoxelRequests,
      });
      if (metrics.admissionAccepted > 0) seenWork = true;
      if (
        processSample.rssBytes >= rssSafetyBytes ||
        availableBytes <= availableSafetyBytes
      ) {
        status = "safety-cutoff";
        break;
      }
      const serverIdle =
        metrics.queueDepth === 0 &&
        metrics.runningJobs === 0 &&
        metrics.inFlightJobs === 0 &&
        metrics.summaryActiveWork === 0 &&
        metrics.summaryLeafBuildActive === 0 &&
        metrics.summaryLeafBuildQueued === 0;
      if (
        seenWork &&
        serverIdle &&
        activeVoxelRequests === 0 &&
        performance.now() - lastVoxelNetworkAt >= quietMs
      ) {
        reachedQuiet = true;
        break;
      }
      await delay(sampleMs);
    }
    if (status === "complete" && !reachedQuiet) status = "timeout";

    const finalMetrics = await requestJson(port, "/api/voxels/metrics");
    await context.close();
    return {
      workers,
      status,
      durationMs: performance.now() - startedAt,
      peakRssBytes: Math.max(...samples.map((sample) => sample.rssBytes)),
      peakCpuPercent: Math.max(
        0,
        ...samples.map((sample) => sample.cpuPercent ?? 0),
      ),
      peakQueueDepth: Math.max(
        0,
        ...samples.map((sample) => sample.queueDepth),
      ),
      peakRunningJobs: Math.max(
        0,
        ...samples.map((sample) => sample.runningJobs),
      ),
      finalMetrics,
      samples,
    };
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolveExit) => child.once("exit", resolveExit)),
      delay(5000),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function seedExtremePreset() {
  localStorage.setItem(
    "cubyz-map-viewer.graphics-settings",
    JSON.stringify({
      version: 3,
      renderDistance: 38400,
      voxelLod1MaxDist: 1150,
      minRenderedVoxelLod: 1,
      mapDebugSettings: {
        atmosphereQuality: 2,
        blockLightQuality: 2,
        frameRateCapFps: 0,
        idleFrameRateCapFps: 15,
        maxConcurrentTerrainFetches: 6,
        terrainMeshBuildBudgetMs: 8,
        maxTerrainMeshesPerFrame: 4,
        maxConcurrentVoxelFetches: 20,
        voxelTopAoIntensity: 1,
        voxelWallAoIntensity: 0.5,
        terrainLodHysteresisRatio: 0.08,
        voxelDetailRequestDebounceMs: 0,
        voxelUnloadGraceMs: 2000,
        voxelMeshBuildBudgetMs: 12,
        maxVoxelMeshesPerFrame: 16,
        lodUnloadHysteresis: 2.25,
        voxelBehindCameraDotStart: -1,
        voxelBehindCameraMaxMultiplier: 1,
        lodReferenceFov: 75,
        lodReferenceViewportHeight: 720,
        warmTerrainCacheMaxBytes: 768 * 1024 * 1024,
        warmVoxelCacheLimitBytes: 1536 * 1024 * 1024,
      },
      parameterVisibility: {
        chunkBorders: false,
        voxelHeightLabels: false,
      },
      layerVisibility: {
        players: true,
        spawn: true,
        debug: false,
        showTerrainUnderlay: true,
        biomeLabels: true,
      },
    }),
  );
}

async function waitForHealth(port, child, output) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited during startup:\n${output.join("")}`);
    }
    try {
      const response = await requestJson(port, "/api/health");
      if (response.status === "ok") return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Server readiness timed out:\n${output.join("")}`);
}

async function requestJson(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

async function readProcessSample(pid) {
  const [stat, status] = await Promise.all([
    readFile(`/proc/${pid}/stat`, "utf8"),
    readFile(`/proc/${pid}/status`, "utf8"),
  ]);
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const rss = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
  return {
    sampledAt: performance.now(),
    cpuTicks: Number(fields[11]) + Number(fields[12]),
    rssBytes: Number(rss?.[1] ?? 0) * 1024,
  };
}

async function readAvailableMemory() {
  const meminfo = await readFile("/proc/meminfo", "utf8");
  const available = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo);
  return Number(available?.[1] ?? 0) * 1024;
}

function cpuSince(previous, current) {
  if (!previous) return null;
  const elapsedSeconds = (current.sampledAt - previous.sampledAt) / 1000;
  const cpuSeconds = (current.cpuTicks - previous.cpuTicks) / clockTicks;
  return (cpuSeconds / elapsedSeconds) * 100;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
