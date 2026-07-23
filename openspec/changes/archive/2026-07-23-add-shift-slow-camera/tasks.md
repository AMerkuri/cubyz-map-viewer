## 1. Camera Precision Movement

- [x] 1.1 Update `updateKeyboardCameraMotion` to apply a 0.5 multiplier only to W/A/S/D and arrow-key translation while `ShiftLeft` or `ShiftRight` is held.
- [x] 1.2 Preserve the existing translation direction normalization, distance and delta-time scaling, Q/E rotation, and Space spawn-focus behavior.

## 2. Controls Guidance

- [x] 2.1 Add a concise Shift slow-movement explanation to the desktop Keyboard section in `MapControlsContent` beside the existing movement shortcut.

## 3. Test Coverage

- [x] 3.1 Add a hermetic `test/core/client/camera-keyboard-motion.test.ts` suite for normal movement and left/right Shift movement at 50% displacement using a fixed frame delta.
- [x] 3.2 Verify the suite covers that Shift alone does not translate the camera and that Shift does not alter Q/E rotation.

## 4. Verification

- [x] 4.1 Run `npm test`.
- [x] 4.2 Run `npm run check`.
- [x] 4.3 Run `npm run check:knip`.
- [x] 4.4 Run `npm run typecheck`.
