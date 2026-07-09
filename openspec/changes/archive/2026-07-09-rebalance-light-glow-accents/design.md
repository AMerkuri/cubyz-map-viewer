## Context

Mesh-local emitted light now provides the desired surface spread, but runtime glow sprites and point lights still create artificial source artifacts. The current sprite texture has a white center and uses additive blending, which can create hard white cores and bright lines over colored terrain.

## Goals / Non-Goals

**Goals:**

- Make glow sprites preserve emitter color instead of introducing white-hot centers.
- Keep source accents subtle enough that mesh-local lighting remains primary.
- Reduce hard lines and additive blowout around clustered emitters.
- Preserve quality controls and bounded runtime budgets.

**Non-Goals:**

- Add post-processing bloom.
- Remove mesh-local emitted-light baking.
- Change server payloads or emitter metadata.

## Decisions

### Decision: Replace white-core glow with color-preserving source highlight

The glow texture/material should avoid a white center that clips to white under additive blending. The source accent should read as the emitter's color with a soft falloff and lower opacity.

Alternatives considered:

- Keep white center and lower opacity only. Rejected because it can still create white seams when several sprites overlap.
- Remove sprites completely. Deferred because a tiny source highlight is useful when the emitting block itself is visually small.

### Decision: Make point lights less prominent at normal quality

Point lights should remain optional sparkle, not the source of the perceived block light. Lower quality settings may disable point-light accents while leaving mesh-local illumination intact.

Alternatives considered:

- Raise point-light budgets. Rejected because it returns to the original blob-light problem.
- Move all source highlighting into shader attributes. Deferred as unnecessary for the current artifact.

### Decision: Tune clustered emitters as a first-class case

Multiple nearby emitter sprites should combine softly. Scale, opacity, and blending should be validated against clustered torches/lava in the known night scene.

## Risks / Trade-offs

- Accents can become too subtle to identify source blocks -> Keep a minimum colored source hint.
- Reducing point lights can make dynamic model blocks less sparkly -> Mesh-local light remains the primary acceptance criterion.
- Blending changes can affect ordering with transparent voxels -> Verify against glass/water and source-adjacent transparent blocks.
