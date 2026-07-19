import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commitMapDebugParameterDisplayValue,
  getMapDebugParameterDisplayRange,
} from "../../../src/client/features/world-view/components/MapDebugParameters.js";
import {
  DEFAULT_MAP_DEBUG_SETTINGS,
  MAP_DEBUG_PARAMETER_DEFINITIONS,
} from "../../../src/client/lib/world-view-debug.js";
import { readStoredGraphicsSettings } from "../../../src/client/lib/world-view-storage.js";

const STORAGE_KEY = "cubyz-map-viewer.graphics-settings";
const MiB = 1024 * 1024;

test("byte-backed controls display and commit MiB exactly once", () => {
  const definition = MAP_DEBUG_PARAMETER_DEFINITIONS.find(
    (item) => item.key === "voxelExpandedOutputMaxBytes",
  );
  assert.ok(definition);
  const range = getMapDebugParameterDisplayRange(definition, 256 * MiB);
  assert.deepEqual(range, { value: 256, min: 1, max: 1024, step: 1 });
  assert.equal(commitMapDebugParameterDisplayValue(definition, 1), MiB);
  assert.equal(commitMapDebugParameterDisplayValue(definition, 256), 256 * MiB);
  assert.equal(
    commitMapDebugParameterDisplayValue(definition, 1024),
    1024 * MiB,
  );
});

test("version-3 settings migrate only the untouched expanded-output default", () => {
  const storage = new Map<string, string>();
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    },
  });
  const base = {
    version: 3,
    renderDistance: 19200,
    voxelLod1MaxDist: 600,
    minRenderedVoxelLod: 1,
    parameterVisibility: {},
    layerVisibility: {},
    mapDebugSettings: {
      ...DEFAULT_MAP_DEBUG_SETTINGS,
      voxelExpandedOutputMaxBytes: 96 * MiB,
    },
  };
  storage.set(STORAGE_KEY, JSON.stringify(base));
  assert.equal(
    readStoredGraphicsSettings()?.mapDebugSettings.voxelExpandedOutputMaxBytes,
    256 * MiB,
  );
  storage.set(
    STORAGE_KEY,
    JSON.stringify({
      ...base,
      mapDebugSettings: {
        ...base.mapDebugSettings,
        voxelExpandedOutputMaxBytes: 128 * MiB,
      },
    }),
  );
  assert.equal(
    readStoredGraphicsSettings()?.mapDebugSettings.voxelExpandedOutputMaxBytes,
    128 * MiB,
  );
});
