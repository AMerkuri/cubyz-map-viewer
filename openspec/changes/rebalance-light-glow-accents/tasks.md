## 1. Baseline Review

- [x] 1.1 Inspect current glow texture, sprite material, point-light intensity, and quality gating behavior.
- [x] 1.2 Capture the known white-core and hard-line scene as the tuning reference.

## 2. Glow Accent Rebalance

- [x] 2.1 Replace the white-centered glow texture or material behavior with a color-preserving source highlight.
- [x] 2.2 Tune sprite opacity, scale, blending, and depth behavior so mesh-local lighting remains primary.
- [x] 2.3 Tune clustered emitter behavior so overlapping accents do not produce hard white seams or lines.

## 3. Point-Light Accent Rebalance

- [x] 3.1 Reduce or gate point-light accents at normal quality if they produce artificial bright cores.
- [x] 3.2 Preserve high-quality optional sparkle without returning to point-light-first lighting.
- [x] 3.3 Keep block-light stats understandable after any budget or quality behavior changes.

## 4. Documentation

- [x] 4.1 Update `docs/client-specification.md` for color-preserving runtime accents and quality behavior.

## 5. Verification

- [x] 5.1 Run `npm run check`.
- [x] 5.2 Run `npm run check:knip`.
- [x] 5.3 Run `npm run typecheck`.
- [x] 5.4 Manually verify the close-up emitter scene has no white-hot sprite core or hard white lines while preserving visible colored source highlights.
