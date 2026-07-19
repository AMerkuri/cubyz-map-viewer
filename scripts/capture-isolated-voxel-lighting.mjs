import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const SUPPORTED_LODS = [1, 2, 4, 8, 16, 32];
const GRAPHICS_STORAGE_KEY = "cubyz-map-viewer.graphics-settings";
const DEFAULT_URL =
  "http://127.0.0.1:5173/?x=794&y=5525&z=51&zoom=500&theta=-90&phi=53&focus=exact";
const DEFAULT_VIEWPORT = { width: 1440, height: 960 };
const DEFAULT_SETTLE_MS = 30_000;

class CaptureValidationError extends Error {}

function parseArgs(argv) {
  const args = {
    lods: [4],
    output: resolve("artifacts/voxel-lighting-captures"),
    settleMs: DEFAULT_SETTLE_MS,
    url: DEFAULT_URL,
    viewport: DEFAULT_VIEWPORT,
    verifyRejection: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argument.includes("=")
      ? argument.slice(argument.indexOf("=") + 1)
      : argv[index + 1];

    if (argument === "--help" || argument === "-h") {
      printUsage();
      return null;
    }
    if (argument === "--lod" || argument.startsWith("--lod=")) {
      args.lods = parseLods(value);
      if (!argument.includes("=")) index += 1;
      continue;
    }
    if (argument === "--output" || argument.startsWith("--output=")) {
      args.output = resolveRequired(value, "--output");
      if (!argument.includes("=")) index += 1;
      continue;
    }
    if (argument === "--settle-ms" || argument.startsWith("--settle-ms=")) {
      args.settleMs = parsePositiveInteger(value, "--settle-ms");
      if (!argument.includes("=")) index += 1;
      continue;
    }
    if (argument === "--url" || argument.startsWith("--url=")) {
      args.url = new URL(resolveRequired(value, "--url")).toString();
      if (!argument.includes("=")) index += 1;
      continue;
    }
    if (argument === "--viewport" || argument.startsWith("--viewport=")) {
      args.viewport = parseViewport(value);
      if (!argument.includes("=")) index += 1;
      continue;
    }
    if (
      argument === "--verify-rejection" ||
      argument.startsWith("--verify-rejection=")
    ) {
      if (value !== "mixed-lod" && value !== "incomplete-light-off") {
        throw new Error(
          "--verify-rejection must be mixed-lod or incomplete-light-off",
        );
      }
      args.verifyRejection = value;
      if (!argument.includes("=")) index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return args;
}

function printUsage() {
  console.log(`Usage: npm run validate:voxel-lighting -- [options]

Options:
  --lod <list>                 Supported LOD or comma-separated LODs (default: 4)
  --url <url>                  Fixed camera URL
  --viewport <width>x<height>  Browser viewport (default: 1440x960)
  --settle-ms <milliseconds>   Time to wait before HUD checks (default: 30000)
  --output <directory>         Artifact output directory
  --verify-rejection <kind>    Assert rejection for mixed-lod or incomplete-light-off
  --help                       Show this help
`);
}

function resolveRequired(value, flag) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(resolveRequired(value, flag), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseLods(value) {
  const lods = resolveRequired(value, "--lod")
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10));
  if (lods.length === 0 || lods.some((lod) => !SUPPORTED_LODS.includes(lod))) {
    throw new Error(
      `--lod must use supported LODs: ${SUPPORTED_LODS.join(", ")}`,
    );
  }
  return [...new Set(lods)];
}

function parseViewport(value) {
  const match = /^([1-9]\d*)x([1-9]\d*)$/i.exec(
    resolveRequired(value, "--viewport"),
  );
  if (!match) {
    throw new Error("--viewport must be formatted as <width>x<height>");
  }
  return {
    width: Number.parseInt(match[1], 10),
    height: Number.parseInt(match[2], 10),
  };
}

function createGraphicsSettings(state) {
  const disabled = state === "disabled";
  return {
    version: 3,
    renderDistance: 19200,
    voxelLod1MaxDist: 1200,
    minRenderedVoxelLod: 1,
    mapDebugSettings: {
      atmosphereTimeOfDay: 0,
      atmosphereQuality: 1,
      blockLightQuality: disabled ? 0 : 1,
      frameRateCapFps: 60,
      idleFrameRateCapFps: 15,
      maxConcurrentTerrainFetches: 4,
      terrainMeshBuildBudgetMs: 4,
      maxTerrainMeshesPerFrame: 2,
      maxConcurrentVoxelFetches: 8,
      voxelTopAoIntensity: 1,
      voxelWallAoIntensity: 0.5,
      terrainLodHysteresisRatio: 0.12,
      voxelDetailRequestDebounceMs: 180,
      voxelUnloadGraceMs: 750,
      voxelMeshBuildBudgetMs: 5,
      maxVoxelMeshesPerFrame: 8,
      lodUnloadHysteresis: 1.5,
      voxelBehindCameraDotStart: -0.5,
      voxelBehindCameraMaxMultiplier: 1.05,
      lodReferenceFov: 60,
      lodReferenceViewportHeight: 2880,
      warmTerrainCacheMaxBytes: 256 * 1024 * 1024,
      warmVoxelCacheLimitBytes: 512 * 1024 * 1024,
      voxelFocusStickyMs: 1500,
      voxelFocusSmoothAlpha: 0.6,
      voxelLodHysteresisRatio: 0.12,
      voxelHaloEmittersEnabled: 1,
      voxelEmissiveAttributesEnabled: disabled ? 0 : 1,
    },
    parameterVisibility: {
      chunkBorders: false,
      voxelHeightLabels: false,
    },
    layerVisibility: {
      players: true,
      spawn: true,
      debug: true,
      showTerrainUnderlay: true,
      biomeLabels: true,
    },
  };
}

function parseLoadedByLod(text) {
  const match =
    /Loaded by LOD\s+L1:(\d+)\s+L2:(\d+)\s+L4:(\d+)\s+L8:(\d+)\s+L16:(\d+)\s+L32:(\d+)/i.exec(
      text,
    );
  if (!match) {
    throw new CaptureValidationError(
      "The Loaded by LOD HUD row was unavailable",
    );
  }
  return Object.fromEntries(
    SUPPORTED_LODS.map((lod, index) => [
      lod,
      Number.parseInt(match[index + 1], 10),
    ]),
  );
}

function parseStatNumber(text, label, unit = "") {
  const match = new RegExp(`${label}:\\s+([0-9.]+)${unit}`).exec(text);
  return match ? Number.parseFloat(match[1]) : null;
}

function parseBytes(text) {
  const match = /Avg emissive bytes:\s+([0-9.]+)\s*(B|KB|MB)/.exec(text);
  if (!match) return null;
  const units = { B: 1, KB: 1024, MB: 1024 * 1024 };
  return Number.parseFloat(match[1]) * units[match[2]];
}

function parseMemoryBytes(text, label) {
  const match = new RegExp(
    `${escapeRegExp(label)}:\\s+([0-9.]+)\\s*(B|KB|MB|GB)`,
  ).exec(text);
  if (!match) return null;
  const units = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  return Number.parseFloat(match[1]) * units[match[2]];
}

function parseP50Ms(text, label) {
  const match = new RegExp(`${escapeRegExp(label)}:\\s+p50\\s+([0-9.]+)`).exec(
    text,
  );
  return match ? Number.parseFloat(match[1]) : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readDiagnostics(text) {
  return {
    activeAccentEmitters: parseStatNumber(text, "Active accent emitters"),
    decodedEmitters: parseStatNumber(text, "Decoded emitters"),
    emissiveBakeMs: parseStatNumber(text, "Avg emissive bake", "\\s+ms"),
    emissiveBytes: parseBytes(text),
    emissiveGridBuildMs: parseStatNumber(text, "Avg emissive grid", "\\s+ms"),
    emissiveSamples: parseStatNumber(text, "Samples"),
    baseWorkerDurationMs: parseP50Ms(text, "Base worker duration"),
    baseVisibleMs: parseP50Ms(
      text,
      "Selection to base-visible state (end-to-end, not additive)",
    ),
    enhancementWorkerDurationMs: parseP50Ms(
      text,
      "Enhancement worker duration",
    ),
    enhancementVisibleMs: parseP50Ms(
      text,
      "Selection to enhanced state (optional, not additive)",
    ),
    frameP50Ms: parseP50Ms(text, "Frame work time"),
    workerDurationP50Ms: parseP50Ms(text, "Worker duration observations"),
    estimatedMemoryBytes: parseMemoryBytes(text, "Total"),
  };
}

function assertCaptureIsolation({ lod, loadedByLod }) {
  if ((loadedByLod[lod] ?? 0) === 0) {
    throw new CaptureValidationError(`LOD ${lod} has no loaded tiles`);
  }
  for (const otherLod of SUPPORTED_LODS) {
    if (otherLod !== lod && (loadedByLod[otherLod] ?? 0) !== 0) {
      throw new CaptureValidationError(
        `LOD ${otherLod} has ${loadedByLod[otherLod]} loaded tiles during an LOD ${lod} capture`,
      );
    }
  }
}

function assertDisabledReference(settings, diagnostics) {
  if (
    settings.mapDebugSettings.blockLightQuality !== 0 ||
    settings.mapDebugSettings.voxelEmissiveAttributesEnabled !== 0
  ) {
    throw new CaptureValidationError(
      "Disabled capture must set blockLightQuality and voxelEmissiveAttributesEnabled to 0",
    );
  }
  if (diagnostics.activeAccentEmitters !== 0) {
    throw new CaptureValidationError(
      `Disabled capture has ${diagnostics.activeAccentEmitters ?? "unknown"} active accent emitters`,
    );
  }
  if (diagnostics.emissiveBytes !== 0 || diagnostics.emissiveBakeMs !== 0) {
    throw new CaptureValidationError(
      "Disabled capture still reports emissive bake output",
    );
  }
}

function createIndexFilter(lod, verifyRejection) {
  if (verifyRejection !== "mixed-lod") {
    return (entry) => entry.lod === lod;
  }
  const witnessLod = SUPPORTED_LODS.find((candidate) => candidate !== lod);
  return (entry) => entry.lod === lod || entry.lod === witnessLod;
}

async function waitForStats(page, settleMs) {
  await page.getByTitle("Expand panel").first().click();
  await page.getByText(/^loaded by lod$/i).waitFor();
  await page.waitForTimeout(settleMs);
  return page.locator("body").innerText();
}

async function captureState({ browser, lod, options, state, directory }) {
  const browserErrors = [];
  const settings = createGraphicsSettings(state);
  if (
    options.verifyRejection === "incomplete-light-off" &&
    state === "disabled"
  ) {
    settings.mapDebugSettings.voxelEmissiveAttributesEnabled = 1;
  }

  const context = await browser.newContext({ viewport: options.viewport });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  let indexEntries = { received: 0, retained: 0 };

  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: GRAPHICS_STORAGE_KEY, value: settings },
  );
  await page.route("**/api/world/chunk-index", async (route) => {
    const response = await route.fetch();
    const source = await response.json();
    if (!Array.isArray(source)) {
      throw new CaptureValidationError("Chunk index response was not an array");
    }
    const filtered = source.filter(
      createIndexFilter(lod, options.verifyRejection),
    );
    indexEntries = { received: source.length, retained: filtered.length };
    await route.fulfill({
      status: response.status(),
      contentType: "application/json",
      body: JSON.stringify(filtered),
    });
  });

  try {
    // The viewer keeps a WebSocket open, so networkidle never represents a
    // settled scene. The HUD assertion after the fixed delay is authoritative.
    await page.goto(options.url, { waitUntil: "domcontentloaded" });
    const statsText = await waitForStats(page, options.settleMs);
    const loadedByLod = parseLoadedByLod(statsText);
    const diagnostics = readDiagnostics(statsText);
    assertCaptureIsolation({ lod, loadedByLod });
    if (state === "disabled") assertDisabledReference(settings, diagnostics);
    if (browserErrors.length > 0) {
      throw new CaptureValidationError(
        `Capture reported browser errors: ${browserErrors.join("; ")}`,
      );
    }

    const imagePath = resolve(directory, `${state}.png`);
    await page.screenshot({ path: imagePath });
    const metadata = {
      state,
      cameraUrl: options.url,
      viewport: options.viewport,
      graphicsSettings: settings,
      chunkIndex: indexEntries,
      loadedByLod,
      browserErrors,
      voxelDiagnostics: diagnostics,
      statsText,
    };
    await writeFile(
      resolve(directory, `${state}.json`),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
    return { imagePath, metadata };
  } finally {
    await context.close();
  }
}

async function compareImages(enabledPath, disabledPath) {
  const [enabled, disabled] = await Promise.all([
    sharp(enabledPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharp(disabledPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);
  if (
    enabled.info.width !== disabled.info.width ||
    enabled.info.height !== disabled.info.height
  ) {
    throw new CaptureValidationError("Paired images have different dimensions");
  }

  let totalDelta = 0;
  let footprintPixels = 0;
  const pixelCount = enabled.info.width * enabled.info.height;
  for (let offset = 0; offset < enabled.data.length; offset += 4) {
    const enabledGray =
      (enabled.data[offset] * 0.2126 +
        enabled.data[offset + 1] * 0.7152 +
        enabled.data[offset + 2] * 0.0722) /
      255;
    const disabledGray =
      (disabled.data[offset] * 0.2126 +
        disabled.data[offset + 1] * 0.7152 +
        disabled.data[offset + 2] * 0.0722) /
      255;
    const delta = Math.abs(enabledGray - disabledGray);
    totalDelta += delta;
    if (delta > 0.02) footprintPixels += 1;
  }

  return {
    dimensions: { width: enabled.info.width, height: enabled.info.height },
    grayscaleAbsoluteDeltaMean: totalDelta / pixelCount,
    threshold: 0.02,
    thresholdFootprintPixels: footprintPixels,
  };
}

async function captureLod(browser, lod, options) {
  const directory = resolve(options.output, `lod-${lod}`);
  await mkdir(directory, { recursive: true });
  const enabled = await captureState({
    browser,
    lod,
    options,
    state: "enabled",
    directory,
  });
  const disabled = await captureState({
    browser,
    lod,
    options,
    state: "disabled",
    directory,
  });
  const metrics = await compareImages(enabled.imagePath, disabled.imagePath);
  const record = {
    lod,
    capturedAt: new Date().toISOString(),
    enabled: enabled.metadata,
    disabled: disabled.metadata,
    metrics,
  };
  await writeFile(
    resolve(directory, "capture.json"),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return record;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) return;

  await mkdir(options.output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const records = [];
    try {
      for (const lod of options.lods) {
        records.push(await captureLod(browser, lod, options));
      }
    } catch (error) {
      if (isExpectedRejection(error, options.verifyRejection)) {
        console.log(`Verified ${options.verifyRejection} capture rejection`);
        return;
      }
      throw error;
    }
    await writeFile(
      resolve(options.output, "summary.json"),
      `${JSON.stringify(records, null, 2)}\n`,
    );
    console.log(
      `Saved ${records.length} isolated capture record(s) to ${options.output}`,
    );
  } finally {
    await browser.close();
  }
}

function isExpectedRejection(error, kind) {
  if (!(error instanceof CaptureValidationError)) return false;
  if (kind === "mixed-lod") return error.message.includes("during an LOD");
  if (kind === "incomplete-light-off") {
    return error.message.startsWith("Disabled capture must set");
  }
  return false;
}

main().catch((error) => {
  if (error instanceof CaptureValidationError) {
    console.error(`Capture rejected: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
