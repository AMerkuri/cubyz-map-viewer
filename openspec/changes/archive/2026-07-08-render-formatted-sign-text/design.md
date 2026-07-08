## Context

The archived `render-sign-text` change recovered sign block-entity payloads and rendered them as on-face texture quads. That implementation matched the storage envelope correctly but assumed sign `text` was plain display text rendered in black.

Cubyz itself uses the same stored bytes differently. The sign block entity stores raw UTF-8 source text, but sign rendering passes it through `graphics.TextBuffer.init(..., initialFontEffect = .{ .color = 0x000000 }, showControlCharacters = false, alignment = .center)`, then calls `calculateLineBreaks(16, 120)` and `renderTextWithoutShadow` into a 128x72 texture with a 4px margin. `TextBuffer.Parser` strips formatting controls from the visible glyph stream and attaches style state per glyph.

The relevant Cubyz source is:
- `/var/home/arturk/Games/Cubyz/src/block_entity.zig`: sign texture rendering path and 128x72/4px layout constants.
- `/var/home/arturk/Games/Cubyz/src/graphics.zig`: `TextBuffer.Parser`, line wrapping, underline/strikethrough, bold/italic effects.
- `/var/home/arturk/Games/Cubyz/src/gui/windows/sign_editor.zig`: sign editor visible character limits use the same parser.
- `/var/home/arturk/Games/Cubyz/src/gui/windows/change_name.zig`: user-facing examples of the markdown-like syntax.

## Goals / Non-Goals

**Goals:**
- Render formatted Cubyz sign text without exposing markup controls as visible glyphs.
- Match Cubyz `TextBuffer.Parser` semantics for `*`, `**`, `__`, `~~`, `\`, `#RRGGBB`, and `§` closely enough that common in-game signs look the same in the map.
- Keep the existing `/api/signs` JSON route shape unless implementation finds a concrete reason to add structured runs.
- Preserve the existing sign quad placement, LOD-1 gate, occlusion behavior, and resource lifecycle.
- Update shared contract documentation to distinguish formatted source text from visible rendered text.

**Non-Goals:**
- Editing signs in the map viewer.
- Pixel-perfect HarfBuzz/Freetype shaping parity with Cubyz beyond the existing Unscii canvas approximation.
- Reimplementing Cubyz text rendering globally for all labels, player names, or chat.
- Introducing external markdown, rich-text, or font-rendering dependencies.
- Changing region block-entity parsing, sign orientation, or text-plane corner generation.

## Decisions

### Decision 1: Keep `SignRecord.text` as formatted source text

The existing route should continue returning `text` as the exact UTF-8 source decoded from the sign block entity. The renderer interprets that source when building the texture.

Rationale: this is the smallest contract correction. The server already preserves the right bytes, sign records are cached by region, and the current bug is caused by client texture creation treating those bytes as final display text. Returning structured runs from the server would be a larger API change while still requiring client-side run-aware wrapping and drawing.

Alternative considered: add `runs` or `displayText` fields to `/api/signs`. That may be useful later for non-browser consumers, but it is not necessary to fix map rendering and would require extra shared-contract surface.

### Decision 2: Implement a small Cubyz text-source parser beside sign texture rendering

Add a parser in the world-view sign texture path that mirrors `TextBuffer.Parser` and outputs visible characters with style state. It should not use a general markdown parser.

Parser rules to mirror:
- `*` toggles italic and is not visible.
- `**` toggles bold and is not visible.
- `__` toggles underline and is not visible; single `_` remains visible.
- `~~` toggles strikethrough and is not visible; single `~` remains visible.
- `\` consumes itself and renders the next codepoint literally with the current style.
- `#` consumes exactly six following codepoints as color nibbles, using `0` for non-hex input, and is not visible.
- `§` resets bold, italic, underline, and strikethrough while preserving the current color, and is not visible.

Rationale: Cubyz formatting is a custom mini-language, not CommonMark. A small local parser keeps behavior explicit, testable through examples, and independent of third-party parsing differences.

Alternative considered: strip only `#RRGGBB`. That fixes the screenshot but leaves bold/italic/underline/strike, escaping, and reset behavior wrong.

### Decision 3: Draw styled runs directly onto the existing canvas texture

`createSignTextTexture` should continue producing one nearest-filtered 128x72 `CanvasTexture`, but it should layout visible styled glyphs/runs instead of raw strings. Wrapping should use visible characters only and measure candidate visible text with the canvas context.

For drawing:
- Color maps to `ctx.fillStyle`.
- Italic maps to an italic canvas font variant if the browser font supports or approximates it.
- Bold maps to a bold canvas font variant or a small synthetic overdraw if that reads closer with Unscii.
- Underline and strikethrough draw 1px horizontal lines in the glyph color across each styled segment.
- Signs continue rendering without shadow.

Rationale: the current texture approach already gives terrain occlusion, orientation, disposal, and LOD behavior. Replacing only text parsing/layout minimizes risk.

Alternative considered: server-side rasterization. That would require a server canvas/font stack and image transport, and would move browser-local texture generation into the route path for little benefit.

### Decision 4: Preserve Cubyz line wrapping shape, accept browser font metric differences

The viewer should keep the existing 128x72, 4px margin, 120x64 usable region, 16px line height, centered alignment, explicit newline handling, and hard mid-word wrapping. Formatting controls must not consume measured width. Browser canvas metrics may differ from Cubyz HarfBuzz/Freetype by a character in edge cases.

Rationale: the archived change already accepted non-pixel-perfect shaping because Unscii is close enough in browser canvas. This change should improve semantic fidelity without expanding scope into full text shaping.

Alternative considered: per-glyph layout with fixed 8px advance. That may better match Unscii in many cases but risks drifting from the browser-rendered glyph metrics and duplicating more of Cubyz's text engine.

## Risks / Trade-offs

- [Parser drift from Cubyz] -> Keep parser rules copied from the identified Cubyz source and document them; avoid generic markdown assumptions.
- [Malformed `#` color controls near end of string] -> Match Cubyz's permissive behavior as closely as practical: consume available following codepoints until input ends; do not render the control marker itself.
- [Canvas bold/italic differ from Cubyz shader effects] -> Prefer readable approximation; exact synthetic shader parity is out of scope.
- [Styled wrapping is more complex than raw string wrapping] -> Keep implementation local to sign texture creation and focus on line/run arrays rather than React state or scene lifecycle changes.
- [White sign text may be low contrast on bright signs] -> Match Cubyz source semantics; do not invent contrast correction for signs.

## Migration Plan

This is an additive client-side rendering correction over the existing sign route. No save migration is needed.

1. Add parser/layout behavior in the client sign texture module.
2. Keep `SignLayerManager` lifecycle unchanged and verify formatted signs rebuild through the existing texture path.
3. Update docs for the sign text contract and Cubyz formatting controls.
4. Run `npm run check && npm run check:knip && npm run typecheck`; run `npm run build` if TypeScript boundary or route payload types change.

Rollback: revert the sign texture parser/layout changes and docs. The server route continues to expose the same raw sign source text either way.

## Open Questions

- Whether to approximate Cubyz bold with canvas `font-weight`, synthetic overdraw, or both after visual testing.
- Whether a future change should expose parsed runs from the server for other consumers; this proposal intentionally avoids that larger contract change.
