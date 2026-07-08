## Why

Sign text rendering currently treats the saved block-entity payload as literal display text, so formatted signs render control sequences such as `#ff0000` directly on the map. Cubyz stores sign text as UTF-8 source interpreted by `graphics.TextBuffer.Parser`, so the viewer needs to mirror that formatting layer to match in-game signs.

## What Changes

- Interpret Cubyz sign text formatting controls before drawing sign textures instead of passing the raw source string directly to `fillText`.
- Render inline color changes, italic, bold, underline, strikethrough, escapes, and style reset according to Cubyz `TextBuffer.Parser` semantics.
- Wrap and center sign text using visible glyphs only, so formatting controls do not consume sign face space.
- Keep the existing `/api/signs` route, LOD-1 gate, text-plane corner contract, and texture-mapped quad rendering model.
- Update sign text contract documentation to distinguish stored formatted source from rendered visible text.

## Capabilities

### New Capabilities
<!-- No new standalone capability; this corrects existing sign text parsing/rendering behavior. -->

### Modified Capabilities
- `sign-text-parsing`: clarify that the UTF-8 `text` value is Cubyz formatted source text and must preserve formatting control characters for rendering.
- `sign-text-rendering`: require Cubyz `TextBuffer.Parser` formatting semantics when producing sign text textures.

## Impact

- **Client sign texture rendering**: `src/client/features/world-view/lib/sign-texture.ts` needs a Cubyz text parser/layout path that emits styled visible text runs instead of rendering raw source text.
- **Client sign layer**: existing quad lifecycle in `sign-layer.ts` should remain unchanged except for consuming the improved texture creation behavior.
- **Shared contract docs**: `docs/architecture-overview.md` and `docs/client-specification.md` must describe formatted sign text rendering; `docs/server-specification.md` must describe sign `text` as formatted source, not plain display text.
- **Server route contract**: route shape can remain additive-compatible if `text` continues carrying the raw formatted source string; no new dependencies are expected.
