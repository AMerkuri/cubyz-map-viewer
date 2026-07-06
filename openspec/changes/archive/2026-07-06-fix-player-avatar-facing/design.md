## Context

Player save files expose entity rotation as `[x, y, z]`, and the server parser forwards that rotation unchanged through `/api/players`. The client uses an identity `worldToScene` mapping for X/Y/Z, so horizontal player facing is controlled by the marker's local Z rotation in `src/client/features/world-view/lib/markers.ts`.

The current marker update path applies `Math.PI - player.rotation[2]`. That expression keeps the previous Cubyz yaw sign conversion but adds a 180 degree offset, causing avatar models to face opposite the saved horizontal direction.

## Goals / Non-Goals

**Goals:**

- Make rendered avatar models face the same horizontal direction represented by each player's Cubyz yaw.
- Keep the correction localized to the player marker visual update path.
- Preserve existing asset loading, coordinate positioning, model normalization, scaling, grounding, labels, active/inactive styling, and fallback marker behavior.
- Add a spec-level expectation so future avatar model work does not reintroduce a 180 degree mismatch.

**Non-Goals:**

- Change `/api/players` payloads or server-side player parsing.
- Change Cubyz coordinate conventions or `worldToScene` behavior.
- Rework avatar asset normalization or supported avatar model resolution.
- Add a runtime orientation configuration per entity model.

## Decisions

- Use the existing client-side Cubyz yaw sign conversion without the 180 degree offset.
  - Rationale: the historical implementation used `-rotation[2]`, the server already supplies Cubyz rotation unchanged, and X/Y/Z scene coordinates are not transformed. The reported symptom is exactly the extra `Math.PI` offset.
  - Alternative considered: change server rotation values before sending them to the client. Rejected because it would alter a shared payload interpretation and affect any future consumer of raw player rotation.

- Keep the fix in `updatePlayerMarkerObject`.
  - Rationale: this function is the single synchronization point for marker position-independent visual rotation during both marker creation and marker updates.
  - Alternative considered: rotate normalized avatar templates in `avatar-assets.ts`. Rejected because template orientation also handles model coordinate systems, and changing it risks affecting model bounds, grounding, and future non-player asset usage.

- Treat fallback dot markers as harmless if they also receive the corrected rotation.
  - Rationale: the existing code applies rotation to either model or fallback marker objects; dots are visually symmetric, so no special case is needed.

## Risks / Trade-offs

- If any individual GLB asset is authored backwards relative to the others, removing the global 180 degree offset could make only that asset face wrong -> mitigate by testing at least the default `cubyz:snale` and one additional supported avatar when available.
- Without automated visual tests, orientation regressions rely on manual observation -> mitigate with a focused manual check using a player looking along a known cardinal direction and the default verification commands.
- The existing comment says the GLB template faces opposite Cubyz yaw -> mitigate by updating the comment during implementation so the code documents the actual yaw convention after the fix.
