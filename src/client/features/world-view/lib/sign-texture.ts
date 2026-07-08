import * as THREE from "three";

// Mirrors the in-game sign render-to-texture layout.
const CANVAS_WIDTH = 128;
const CANVAS_HEIGHT = 72;
const MARGIN = 4;
const USABLE_WIDTH = CANVAS_WIDTH - MARGIN * 2; // 120
const USABLE_HEIGHT = CANVAS_HEIGHT - MARGIN * 2; // 64
const LINE_HEIGHT = 16;
const UNDERLINE_Y_OFFSET = 15; // 15px below the top of the line (font-space → pixel)
const STRIKETHROUGH_Y_OFFSET = 8; // 8px below the top of the line
const DECORATION_THICKNESS = 1; // pixel height of underline/strikethrough runs
const FONT_FAMILY = `"Unscii16", "Unscii", monospace`;
const FONT_SIZE = 16;

/**
 * Initial sign text color — black, matching
 * `graphics.TextBuffer.init(initialFontEffect = .{ .color = 0x000000 })`.
 */
const DEFAULT_COLOR = 0x000000;

/**
 * Per-glyph style state carried from the Cubyz `TextBuffer.Parser`.
 *
 * `color` is a 24-bit RGB value (matching the in-game u24 layout): bits 23..16
 * are red, 15..8 green, 7..0 blue. The other flags are direct booleans that
 * mirror `FontEffect` (`bold`, `italic`, `underline`, `strikethrough`).
 */
interface SignStyle {
  color: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
}

/**
 * A single visible codepoint emitted by the sign-text parser together with the
 * style state active at the moment it was emitted. Formatting control markers
 * never appear here; only visible characters (and `\n` hard breaks) do.
 */
interface SignChar {
  char: string;
  style: SignStyle;
}

/**
 * Paint sign text into a 128x72 canvas and wrap it in a nearest-filtered
 * `THREE.CanvasTexture`. Layout matches the game: 4px margin, Unscii-16, black
 * initial color, transparent background, per-line centered, `\n` + word-wrap at
 * the usable width with hard mid-word breaks, 16px line height, clipped past the
 * usable height. Formatted source text is interpreted with Cubyz
 * `TextBuffer.Parser` semantics before layout, so color codes, bold, italic,
 * underline, strikethrough, escapes, and reset do not render as visible glyphs.
 * Callers own the returned texture and must dispose it on rebuild.
 */
export function createSignTextTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    const chars = parseSignText(text);
    const lines = layoutSignLines(ctx, chars);
    drawSignLines(ctx, lines);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Convert formatted source text into a list of visible codepoints with the
 * style state active when each was emitted, mirroring Cubyz
 * `TextBuffer.Parser.parse` with `showControlCharacters = false`.
 *
 * Rules mirrored from `/var/home/arturk/Games/Cubyz/src/graphics.zig`:
 * - `*` toggles italic. `**` toggles bold.
 * - `__` toggles underline; a single `_` is visible.
 * - `~~` toggles strikethrough; a single `~` is visible.
 * - `\` consumes itself and renders the next codepoint literally.
 * - `#` consumes up to six following codepoints as hex color nibbles, using `0`
 *   for non-hex input, and silently dropping control at end-of-input.
 * - `§` resets bold/italic/underline/strikethrough while preserving the color.
 *
 * Newlines (`\n`) are emitted as visible `SignChar` entries so the layout step
 * can split paragraphs on hard breaks before word-wrapping.
 */
function parseSignText(text: string): SignChar[] {
  // Split into codepoints so surrogate pairs are kept intact. Index-based
  // iteration gives us a non-destructive `peekNext`, which a JavaScript string
  // iterator cannot provide directly.
  const codepoints = Array.from(text);
  const chars: SignChar[] = [];
  const style: SignStyle = {
    color: DEFAULT_COLOR,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
  };
  let i = 0;

  // Non-destructive peek of the codepoint following the current position.
  const peekNext = (): string | null =>
    i + 1 < codepoints.length ? (codepoints[i + 1] ?? null) : null;

  // Mirror `Parser.appendControlGetNext` (signs disable
  // `showControlCharacters`): consume the current control codepoint without
  // rendering it, then return whether the new position still has a codepoint
  // to process. A `false` return mirrors Cubyz's `orelse return` and means the
  // caller must abort the in-progress control action without applying toggles.
  const consumeControl = (): boolean => {
    i += 1;
    return i < codepoints.length;
  };

  // Mirror `Parser.appendGetNext`: append the current codepoint as visible text
  // using the active style, then advance. Returns `false` when the iteration
  // reached end-of-input after consuming this character.
  const appendVisible = (): boolean => {
    const cp = codepoints[i];
    if (cp === undefined) return false;
    chars.push({ char: cp, style: { ...style } });
    i += 1;
    return i < codepoints.length;
  };

  while (i < codepoints.length) {
    const c = codepoints[i];
    if (c === undefined) break;
    switch (c) {
      case "*": {
        if (!consumeControl()) return chars;
        if (codepoints[i] === "*") {
          if (!consumeControl()) return chars;
          style.bold = !style.bold;
        } else {
          style.italic = !style.italic;
        }
        break;
      }
      case "_": {
        if (peekNext() === "_") {
          if (!consumeControl()) return chars;
          if (!consumeControl()) return chars;
          style.underline = !style.underline;
        } else {
          if (!appendVisible()) return chars;
        }
        break;
      }
      case "~": {
        if (peekNext() === "~") {
          if (!consumeControl()) return chars;
          if (!consumeControl()) return chars;
          style.strikethrough = !style.strikethrough;
        } else {
          if (!appendVisible()) return chars;
        }
        break;
      }
      case "\\": {
        if (!consumeControl()) return chars;
        if (!appendVisible()) return chars;
        break;
      }
      case "#": {
        if (!consumeControl()) return chars;
        let shift: number = 20;
        while (true) {
          const cp = codepoints[i];
          if (cp === undefined) return chars;
          const nibble = hexNibble(cp);
          style.color = (style.color & ~(0xf << shift)) | (nibble << shift);
          if (!consumeControl()) return chars;
          if (shift === 0) break;
          shift -= 4;
        }
        break;
      }
      case "§": {
        style.bold = false;
        style.italic = false;
        style.underline = false;
        style.strikethrough = false;
        if (!consumeControl()) return chars;
        break;
      }
      default: {
        if (!appendVisible()) return chars;
        break;
      }
    }
  }

  return chars;
}

function hexNibble(char: string): number {
  const code = char.charCodeAt(0);
  if (code >= 0x30 && code <= 0x39) return code - 0x30; // '0'..'9'
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10; // 'a'..'f'
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10; // 'A'..'F'
  return 0;
}

/**
 * Break visible sign glyphs into rendered lines, matching Cubyz
 * `TextBuffer.calculateLineBreaks` and the existing viewer greedy wrapper:
 * split on explicit `\n`, then greedily word-wrap at the usable width using
 * canvas `measureText` (with the active per-glyph style so bold/italic are
 * measured correctly), hard-breaking a single word that is wider than the line.
 * Only visible text is measured — formatting controls have already been removed
 * by `parseSignText` and therefore never consume wrap width.
 */
function layoutSignLines(
  ctx: CanvasRenderingContext2D,
  chars: SignChar[],
): SignChar[][] {
  const lines: SignChar[][] = [];
  let paragraph: SignChar[] = [];
  for (const ch of chars) {
    if (ch.char === "\n") {
      wrapParagraph(ctx, paragraph, lines);
      paragraph = [];
    } else {
      paragraph.push(ch);
    }
  }
  wrapParagraph(ctx, paragraph, lines);
  return lines;
}

function wrapParagraph(
  ctx: CanvasRenderingContext2D,
  paragraph: SignChar[],
  out: SignChar[][],
): void {
  if (paragraph.length === 0) {
    out.push([]);
    return;
  }

  let line: SignChar[] = [];
  let lineWidth = 0;
  let lastSpaceWidth = 0;
  let lastSpaceIndexInLine = -1;

  for (const ch of paragraph) {
    ctx.font = fontForStyle(ch.style);
    const advance = ctx.measureText(ch.char).width;
    line.push(ch);
    lineWidth += advance;

    if (ch.char === " ") {
      lastSpaceWidth = lineWidth;
      lastSpaceIndexInLine = line.length - 1;
    }

    if (lineWidth > USABLE_WIDTH) {
      if (lastSpaceIndexInLine >= 0) {
        const kept = line.slice(0, lastSpaceIndexInLine);
        const remainder = line.slice(lastSpaceIndexInLine + 1);
        out.push(kept);
        line = remainder;
        lineWidth -= lastSpaceWidth;
        lastSpaceWidth = 0;
        lastSpaceIndexInLine = -1;
      } else {
        const overflow = line.pop();
        out.push(line);
        line = overflow ? [overflow] : [];
        lineWidth = overflow ? measureWithStyle(ctx, overflow) : 0;
        lastSpaceWidth = 0;
        lastSpaceIndexInLine = -1;
      }
    }
  }

  if (line.length > 0) out.push(line);
}

function measureWithStyle(ctx: CanvasRenderingContext2D, ch: SignChar): number {
  ctx.font = fontForStyle(ch.style);
  return ctx.measureText(ch.char).width;
}

/**
 * Build the canvas font string for a sign style. Bold and italic map to the
 * corresponding canvas font variants (browser synthesis approximates Unscii
 * shader effects); color is applied separately through `ctx.fillStyle`.
 */
function fontForStyle(style: SignStyle): string {
  const variants: string[] = [];
  if (style.italic) variants.push("italic");
  if (style.bold) variants.push("bold");
  const prefix = variants.length > 0 ? `${variants.join(" ")}` : "";
  return `${prefix} ${FONT_SIZE}px ${FONT_FAMILY}`.trim();
}

function colorToCss(color: number): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function drawSignLines(
  ctx: CanvasRenderingContext2D,
  lines: SignChar[][],
): void {
  const maxLines = Math.floor(USABLE_HEIGHT / LINE_HEIGHT);
  const centerX = CANVAS_WIDTH / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(MARGIN, MARGIN, USABLE_WIDTH, USABLE_HEIGHT);
  ctx.clip();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const lineCount = Math.min(lines.length, maxLines);
  for (let i = 0; i < lineCount; i++) {
    const y = MARGIN + i * LINE_HEIGHT;
    const line = lines[i] ?? [];
    if (line.length === 0) continue;

    const lineWidth = measureLine(ctx, line);
    const startX = centerX - lineWidth / 2;
    drawStyledRun(ctx, line, startX, y);
  }

  ctx.restore();
}

function measureLine(ctx: CanvasRenderingContext2D, line: SignChar[]): number {
  let total = 0;
  for (const ch of line) {
    ctx.font = fontForStyle(ch.style);
    total += ctx.measureText(ch.char).width;
  }
  return total;
}

function drawStyledRun(
  ctx: CanvasRenderingContext2D,
  line: SignChar[],
  startX: number,
  y: number,
): void {
  let x = startX;

  for (const ch of line) {
    ctx.font = fontForStyle(ch.style);
    ctx.fillStyle = colorToCss(ch.style.color);
    ctx.fillText(ch.char, x, y);

    const width = ctx.measureText(ch.char).width;
    if (ch.style.underline) {
      drawHorizontalRun(
        ctx,
        colorToCss(ch.style.color),
        x,
        y + UNDERLINE_Y_OFFSET,
        width,
      );
    }
    if (ch.style.strikethrough) {
      drawHorizontalRun(
        ctx,
        colorToCss(ch.style.color),
        x,
        y + STRIKETHROUGH_Y_OFFSET,
        width,
      );
    }
    x += width;
  }
}

function drawHorizontalRun(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  width: number,
): void {
  if (width <= 0) return;
  const previousFillStyle = ctx.fillStyle;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, DECORATION_THICKNESS);
  ctx.fillStyle = previousFillStyle;
}
