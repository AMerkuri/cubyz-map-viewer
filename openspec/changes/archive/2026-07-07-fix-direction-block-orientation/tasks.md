## 1. Direction Transform Implementation

- [x] 1.1 Inspect current `cubyz:direction` handling in `src/server/services/voxel-generator.ts` and confirm it is isolated from other semantic modes.
- [x] 1.2 Add a direction-specific model vertex transform path that mirrors Cubyz `direction.zig` data values `0..5` around block center `(0.5, 0.5, 0.5)`.
- [x] 1.3 Clamp direction block `data` values above `5` to the same orientation as data value `5`, matching Cubyz model selection.
- [x] 1.4 Update direction quad selection to use the new direction transform path without changing carpet, sign, hanging, fence, branch, stairs, or texture-pile behavior.

## 2. Cache Validity

- [x] 2.1 Bump or otherwise update the shape semantic signature used by voxel cache keys so persisted meshes generated with the old direction orientation are invalidated.
- [x] 2.2 Confirm the change does not alter `/api/voxels` route payload structure, binary mesh layout, compression requirements, or client worker decoding.

## 3. Verification

- [x] 3.1 Add focused verification for direction transform mapping, covering data values `0..5` and an out-of-range value above `5` if the existing test/tooling structure allows it.
- [x] 3.2 Manually verify the reported URL `http://localhost:5173/?x=7731&y=4124&z=33&zoom=3&theta=63&phi=60&focus=exact` renders `cubyz:chain/iron` placement consistent with the in-game screenshot.
- [x] 3.3 Run `npm run check`.
- [x] 3.4 Run `npm run check:knip`.
- [x] 3.5 Run `npm run typecheck`.
