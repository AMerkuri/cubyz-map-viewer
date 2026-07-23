## Why

Keyboard camera movement is distance-scaled, which can make precise positioning difficult. Users need a temporary precision mode without changing their normal navigation speed or camera orientation controls.

## What Changes

- Add a Shift modifier that reduces W/A/S/D and arrow-key camera translation to 50% of the normal distance-scaled speed while held.
- Keep Q/E orbit rotation and Space spawn focus behavior unchanged when Shift is held.
- Document the Shift precision-movement shortcut in the desktop Map Controls keyboard instructions.
- Add a unit test covering normal and Shift-modified keyboard translation behavior.

## Capabilities

### New Capabilities
- `keyboard-camera-navigation`: Keyboard-driven camera translation, precision movement, and keyboard-control guidance in Map Controls.

### Modified Capabilities

None.

## Impact

- Client behavior in `src/client/features/world-view/lib/camera.ts` and its existing keyboard input flow in `src/client/features/world-view/lib/scene-runtime.ts`.
- Desktop keyboard help in `src/client/features/world-controls/components/MapControlsContent.tsx`.
- Client-side unit test coverage for camera keyboard movement.
- No server APIs, shared contracts, dependencies, deployment behavior, or contributor documentation changes.
