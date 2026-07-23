## Context

The scene runtime records held keyboard keys as `KeyboardEvent.code` values and passes them to the imperative `updateKeyboardCameraMotion` function every rendered frame. That function already calculates a distance- and delta-time-scaled translation speed for W/A/S/D and arrow-key movement, while Q/E rotation is calculated separately. The Map Controls content owns the desktop keyboard shortcut text.

## Goals / Non-Goals

**Goals:**
- Provide a temporary precision-navigation modifier that makes translation run at exactly 50% of its existing calculated speed.
- Support both physical Shift keys through their existing `ShiftLeft` and `ShiftRight` keyboard codes.
- Preserve all existing movement directions, diagonal normalization, distance scaling, Q/E rotation, and Space behavior.
- Make the modifier discoverable in the desktop Map Controls keyboard instructions.
- Add direct unit coverage for normal and Shift-modified camera translation.

**Non-Goals:**
- Adding configurable movement speeds, persistent user preferences, or touch equivalents.
- Changing orbit rotation speed, zooming, focus behavior, key event handling, or server behavior.
- Reworking camera controls into React state or changing the scene runtime architecture.

## Decisions

### Apply the multiplier only to translation

When either `ShiftLeft` or `ShiftRight` is present in the held-key set, the translation speed calculated by `updateKeyboardCameraMotion` will be multiplied by `0.5` before it is applied to the normalized horizontal movement vector. The modifier has no effect unless a W/A/S/D or arrow translation key is active.

This keeps the requested behavior narrowly scoped to movement and avoids unintentionally changing the independently calculated Q/E orbit rotation.

Alternative considered: scale the per-frame delta time for all camera input. Rejected because it would also slow rotation and could affect future keyboard behaviors.

### Reuse the existing held-key representation

The implementation will inspect the existing `Set<string>` of `KeyboardEvent.code` values rather than adding a separate modifier-state pathway. This reflects the browser's physical key codes, supports either Shift key, and remains correct across the animation frames between keydown and keyup events.

Alternative considered: read `KeyboardEvent.shiftKey` in key handlers. Rejected because the motion calculation is frame-based and needs persistent state after the original event has completed.

### Document the modifier beside translation help

The desktop Keyboard instructions will add a concise Shift slow-movement explanation immediately after the existing W/A/S/D-or-arrows movement instruction. The compact touch-only controls content remains unchanged because it does not expose keyboard instructions.

Alternative considered: combine the modifier into the main movement line. Rejected because a separate line is easier to scan and avoids making the base movement shortcut harder to read.

### Test the pure motion boundary

Add a unit test around `updateKeyboardCameraMotion` using a deterministic camera/controls setup and fixed delta. It will compare normal translation to ShiftLeft and ShiftRight translation, assert each Shift result moves half as far, and confirm Q/E rotation is identical with and without Shift.

This tests the behavior at the smallest direct boundary without requiring a browser, WebGL renderer, or scene-runtime event wiring.

## Risks / Trade-offs

- [A modifier code is checked incorrectly] → Cover both `ShiftLeft` and `ShiftRight` in unit tests.
- [The modifier inadvertently slows orbit rotation] → Apply it exclusively to the translation speed and include a rotation-invariance test.
- [Keyboard help becomes out of sync] → Update the help text in the same change as the behavior.
- [A frame-rate-dependent regression is introduced] → Retain the existing delta-time calculation and assert relative displacement using a fixed delta in tests.

## Migration Plan

No migration or rollout procedure is required. The client behavior changes immediately when the updated viewer is deployed. Rollback consists of reverting the client-only change.

## Open Questions

None. The slow-speed multiplier is fixed at 0.5 for this change.
