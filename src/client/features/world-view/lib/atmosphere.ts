import * as THREE from "three";

const DEFAULT_ATMOSPHERE_TIME_OF_DAY = 12;

interface AtmosphereSettings {
  timeOfDay: number;
  quality: number;
}

interface AtmosphereState {
  enabled: boolean;
  timeOfDay: number;
  sunDirection: THREE.Vector3;
  skyTopColor: THREE.Color;
  skyHorizonColor: THREE.Color;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  ambientColor: THREE.Color;
  ambientIntensity: number;
  hemisphereSkyColor: THREE.Color;
  hemisphereGroundColor: THREE.Color;
  hemisphereIntensity: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  fillColor: THREE.Color;
  fillIntensity: number;
  depthEnhancementEnabled: boolean;
  sunShaftsSupported: false;
  sunShaftsVisible: false;
}

interface AtmosphereRuntime {
  container: HTMLDivElement;
  ambientLight: THREE.AmbientLight;
  hemisphereLight: THREE.HemisphereLight;
  sunLight: THREE.DirectionalLight;
  fillLight: THREE.DirectionalLight;
  apply: (settings: AtmosphereSettings) => void;
  dispose: () => void;
}

const BASELINE_BACKGROUND = new THREE.Color(0x1a1a2e);
const BASELINE_AMBIENT_COLOR = new THREE.Color(0x43485a);
const BASELINE_HEMISPHERE_SKY_COLOR = new THREE.Color(0xd7e7ff);
const BASELINE_HEMISPHERE_GROUND_COLOR = new THREE.Color(0x66704f);
const BASELINE_SUN_COLOR = new THREE.Color(0xffffff);
const BASELINE_FILL_COLOR = new THREE.Color(0xbec8d8);

const TEMP_COLOR = new THREE.Color();
const TEMP_COLOR_ALT = new THREE.Color();

export function createAtmosphereRuntime(args: {
  container: HTMLDivElement;
  scene: THREE.Scene;
  quality: number;
  timeOfDay: number;
}): AtmosphereRuntime {
  const { container, scene } = args;

  const ambientLight = new THREE.AmbientLight(BASELINE_AMBIENT_COLOR, 0.7);
  const hemisphereLight = new THREE.HemisphereLight(
    BASELINE_HEMISPHERE_SKY_COLOR,
    BASELINE_HEMISPHERE_GROUND_COLOR,
    0.55,
  );
  hemisphereLight.position.set(0, 0, 1);
  const sunLight = new THREE.DirectionalLight(BASELINE_SUN_COLOR, 1.75);
  const fillLight = new THREE.DirectionalLight(BASELINE_FILL_COLOR, 0.18);

  scene.add(ambientLight, hemisphereLight, sunLight, fillLight);

  const runtime: AtmosphereRuntime = {
    container,
    ambientLight,
    hemisphereLight,
    sunLight,
    fillLight,
    apply(settings) {
      applyAtmosphereToScene({ scene, runtime, settings });
    },
    dispose() {
      scene.remove(ambientLight, hemisphereLight, sunLight, fillLight);
      container.style.background = "";
    },
  };

  runtime.apply({ quality: args.quality, timeOfDay: args.timeOfDay });
  return runtime;
}

function resolveAtmosphereState(settings: AtmosphereSettings): AtmosphereState {
  const quality = Math.round(settings.quality);
  if (quality <= 0) {
    return createBaselineAtmosphereState(settings.timeOfDay);
  }

  const timeOfDay = normalizeTimeOfDay(settings.timeOfDay);
  const sunAngle = ((timeOfDay - 6) / 24) * Math.PI * 2;
  const sunHeight = Math.sin(sunAngle);
  const lowSun = Math.max(0, 1 - Math.abs(sunHeight) / 0.42);
  const dayAmount = THREE.MathUtils.smoothstep(sunHeight, -0.1, 0.55);
  const nightAmount = 1 - THREE.MathUtils.smoothstep(sunHeight, -0.28, 0.08);
  const duskAmount = lowSun * (1 - nightAmount * 0.55);
  const sunDirection = new THREE.Vector3(
    Math.cos(sunAngle) * 0.56,
    -0.72,
    Math.max(-0.18, sunHeight),
  ).normalize();

  const skyTopColor = mixColors(0x081021, 0x4fa7df, dayAmount).lerp(
    TEMP_COLOR_ALT.setHex(0x3a1f50),
    duskAmount * 0.42,
  );
  const skyHorizonColor = mixColors(0x172040, 0xbddfff, dayAmount).lerp(
    TEMP_COLOR_ALT.setHex(0xff9b58),
    duskAmount * 0.58,
  );
  const fogColor = mixColors(0x101526, 0x8fb8d5, dayAmount).lerp(
    TEMP_COLOR_ALT.setHex(0x4d3152),
    duskAmount * 0.35,
  );

  return {
    enabled: true,
    timeOfDay,
    sunDirection,
    skyTopColor,
    skyHorizonColor,
    fogColor,
    fogNear: quality >= 2 ? 11_000 : 15_000,
    fogFar: quality >= 2 ? 42_000 : 50_000,
    ambientColor: mixColors(0x1d243c, 0x4e5566, dayAmount),
    ambientIntensity: THREE.MathUtils.lerp(0.34, 0.72, dayAmount),
    hemisphereSkyColor: mixColors(0x253562, 0xd7e7ff, dayAmount).lerp(
      TEMP_COLOR_ALT.setHex(0xffc18a),
      duskAmount * 0.22,
    ),
    hemisphereGroundColor: mixColors(0x273027, 0x66704f, dayAmount),
    hemisphereIntensity: THREE.MathUtils.lerp(0.3, 0.62, dayAmount),
    sunColor: mixColors(0x9fb6ff, 0xffffff, dayAmount).lerp(
      TEMP_COLOR_ALT.setHex(0xffb06a),
      duskAmount * 0.46,
    ),
    sunIntensity:
      THREE.MathUtils.lerp(0.35, 1.85, dayAmount) + duskAmount * 0.24,
    fillColor: mixColors(0x596580, 0xbec8d8, dayAmount),
    fillIntensity: THREE.MathUtils.lerp(0.1, 0.2, dayAmount),
    depthEnhancementEnabled: quality >= 1,
    sunShaftsSupported: false,
    sunShaftsVisible: false,
  };
}

function applyAtmosphereToScene(args: {
  scene: THREE.Scene;
  runtime: AtmosphereRuntime;
  settings: AtmosphereSettings;
}) {
  const { scene, runtime, settings } = args;
  const state = resolveAtmosphereState(settings);

  if (state.enabled) {
    runtime.container.style.background = createSkyBackground(
      state.skyTopColor,
      state.skyHorizonColor,
    );
  } else {
    runtime.container.style.background = `#${BASELINE_BACKGROUND.getHexString()}`;
  }
  scene.background = state.enabled ? null : BASELINE_BACKGROUND;
  scene.fog = state.depthEnhancementEnabled
    ? new THREE.Fog(state.fogColor, state.fogNear, state.fogFar)
    : null;

  runtime.ambientLight.color.copy(state.ambientColor);
  runtime.ambientLight.intensity = state.ambientIntensity;
  runtime.hemisphereLight.color.copy(state.hemisphereSkyColor);
  runtime.hemisphereLight.groundColor.copy(state.hemisphereGroundColor);
  runtime.hemisphereLight.intensity = state.hemisphereIntensity;
  runtime.sunLight.color.copy(state.sunColor);
  runtime.sunLight.intensity = state.sunIntensity;
  runtime.sunLight.position.copy(state.sunDirection).multiplyScalar(330);
  runtime.fillLight.color.copy(state.fillColor);
  runtime.fillLight.intensity = state.fillIntensity;
  runtime.fillLight.position.copy(state.sunDirection).multiplyScalar(-190);
  runtime.fillLight.position.z = Math.max(120, runtime.fillLight.position.z);
}

function createSkyBackground(
  topColor: THREE.Color,
  horizonColor: THREE.Color,
): string {
  const top = `#${topColor.getHexString()}`;
  const horizon = `#${horizonColor.getHexString()}`;
  return `linear-gradient(180deg, ${top} 0%, ${horizon} 74%, ${horizon} 100%)`;
}

function createBaselineAtmosphereState(timeOfDay: number): AtmosphereState {
  return {
    enabled: false,
    timeOfDay: normalizeTimeOfDay(timeOfDay),
    sunDirection: new THREE.Vector3(140, -90, 300).normalize(),
    skyTopColor: BASELINE_BACKGROUND.clone(),
    skyHorizonColor: BASELINE_BACKGROUND.clone(),
    fogColor: BASELINE_BACKGROUND.clone(),
    fogNear: 0,
    fogFar: 0,
    ambientColor: BASELINE_AMBIENT_COLOR.clone(),
    ambientIntensity: 0.7,
    hemisphereSkyColor: BASELINE_HEMISPHERE_SKY_COLOR.clone(),
    hemisphereGroundColor: BASELINE_HEMISPHERE_GROUND_COLOR.clone(),
    hemisphereIntensity: 0.55,
    sunColor: BASELINE_SUN_COLOR.clone(),
    sunIntensity: 1.75,
    fillColor: BASELINE_FILL_COLOR.clone(),
    fillIntensity: 0.18,
    depthEnhancementEnabled: false,
    sunShaftsSupported: false,
    sunShaftsVisible: false,
  };
}

function normalizeTimeOfDay(timeOfDay: number): number {
  if (!Number.isFinite(timeOfDay)) return DEFAULT_ATMOSPHERE_TIME_OF_DAY;
  return ((timeOfDay % 24) + 24) % 24;
}

function mixColors(from: number, to: number, amount: number): THREE.Color {
  return TEMP_COLOR.setHex(from)
    .clone()
    .lerp(TEMP_COLOR_ALT.setHex(to), amount);
}
