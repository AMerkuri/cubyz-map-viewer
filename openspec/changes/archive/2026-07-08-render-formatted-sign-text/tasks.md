## 1. Parser And Layout

- [x] 1.1 Add a local Cubyz sign text parser in the world-view sign texture area that converts formatted source text into visible styled characters or runs.
- [x] 1.2 Implement Cubyz control semantics for italic `*`, bold `**`, underline `__`, strikethrough `~~`, escaped next codepoint `\`, color `#RRGGBB`, and reset `§`.
- [x] 1.3 Ensure parser behavior preserves visible escaped control characters and does not render formatting control markers.
- [x] 1.4 Update sign line wrapping to measure and wrap visible text only while retaining per-segment style information.

## 2. Texture Rendering

- [x] 2.1 Update `createSignTextTexture` to draw styled sign runs onto the existing 128x72 canvas with 4px margin, 120px usable width, 16px line height, centered alignment, and clipping.
- [x] 2.2 Render inline colors through canvas fill styles with black as the initial sign color.
- [x] 2.3 Approximate Cubyz bold and italic effects with canvas font styling or small synthetic overdraw/shear where needed.
- [x] 2.4 Draw underline and strikethrough as 1px horizontal lines in the active segment color.
- [x] 2.5 Keep existing nearest-filtered `CanvasTexture`, transparent background, no-shadow rendering, and sign quad lifecycle unchanged.

## 3. Contract And Documentation

- [x] 3.1 Confirm `/api/signs` still returns `text` as exact formatted source text and no server-side stripping is introduced.
- [x] 3.2 Update `docs/architecture-overview.md` to describe sign text as formatted source rendered with Cubyz parser semantics.
- [x] 3.3 Update `docs/server-specification.md` to clarify that sign records preserve Cubyz formatted source text.
- [x] 3.4 Update `docs/client-specification.md` to document formatted sign text parsing, styled drawing, and visible-text wrapping.

## 4. Verification

- [x] 4.1 Manually verify a sign like `#ff0000EVIL#000000SNALE#ffffff was here` renders as colored visible text without raw color markers.
- [ ] 4.2 Manually verify bold, italic, underline, strikethrough, escape, reset, newline, wrap, and clipping behavior on LOD-1 sign quads.
- [x] 4.3 Run `npm run check`.
- [x] 4.4 Run `npm run check:knip`.
- [x] 4.5 Run `npm run typecheck`.
