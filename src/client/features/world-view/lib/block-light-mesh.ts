import type * as THREE from "three";

export const VOXEL_EMISSIVE_ATTRIBUTE = "emissiveLight";

// Mesh-local emitted light stays subtly visible at day (Cubyz block light is
// not sun-gated) and ramps to full strength at night. The runtime multiplies
// this floor/ceiling by night strength and quality gating.
export const MESH_BLOCK_LIGHT_DAY_FLOOR = 0.3;

const strengthUniform: { value: number } = { value: 0 };

/**
 * Patches the shared opaque voxel MeshLambertMaterial so the worker-baked
 * per-vertex `emissiveLight` attribute is added as emissive radiance,
 * independent of scene light intensity. Geometries without the attribute
 * read the WebGL default of (0,0,0), so emitter-free tiles render unchanged.
 * A single shared uniform keeps the contribution gated by atmosphere and
 * block-light quality without per-vertex rewrites when time of day changes.
 */
export function patchVoxelMaterialWithBlockLight(
  material: THREE.Material,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.blockLightStrength = strengthUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        [
          "#include <common>",
          `attribute vec3 ${VOXEL_EMISSIVE_ATTRIBUTE};`,
          "varying vec3 vBlockLightEmissive;",
        ].join("\n"),
      )
      .replace(
        "#include <begin_vertex>",
        [
          "#include <begin_vertex>",
          `\tvBlockLightEmissive = ${VOXEL_EMISSIVE_ATTRIBUTE};`,
        ].join("\n"),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        [
          "#include <common>",
          "uniform float blockLightStrength;",
          "varying vec3 vBlockLightEmissive;",
        ].join("\n"),
      )
      .replace(
        "#include <emissivemap_fragment>",
        [
          "#include <emissivemap_fragment>",
          "\ttotalEmissiveRadiance += vBlockLightEmissive * blockLightStrength;",
        ].join("\n"),
      );
  };
  material.customProgramCacheKey = () => "voxel-block-light";
  material.needsUpdate = true;
}

export function setMeshBlockLightStrength(value: number): void {
  strengthUniform.value = Math.max(0, Math.min(1, value));
}
