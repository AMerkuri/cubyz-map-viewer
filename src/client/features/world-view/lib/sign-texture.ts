import * as THREE from "three";

// Mirrors the in-game sign render-to-texture layout.
const CANVAS_WIDTH = 128;
const CANVAS_HEIGHT = 72;
const MARGIN = 4;
const USABLE_WIDTH = CANVAS_WIDTH - MARGIN * 2; // 120
const USABLE_HEIGHT = CANVAS_HEIGHT - MARGIN * 2; // 64
const LINE_HEIGHT = 16;
const FONT = `16px "Unscii16", "Unscii", monospace`;
const TEXT_COLOR = "#000000";

/**
 * Paint sign text into a 128x72 canvas and wrap it in a nearest-filtered
 * `THREE.CanvasTexture`. Layout matches the game: 4px margin, Unscii-16, black,
 * transparent background, per-line centered, `\n` + word-wrap at the usable
 * width with hard mid-word breaks, 16px line height, clipped past the usable
 * height. Callers own the returned texture and must dispose it on rebuild.
 */
export function createSignTextTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.font = FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = TEXT_COLOR;

    const lines = layoutSignLines(ctx, text);
    const maxLines = Math.floor(USABLE_HEIGHT / LINE_HEIGHT);
    const centerX = CANVAS_WIDTH / 2;
    for (let i = 0; i < lines.length && i < maxLines; i++) {
      const y = MARGIN + i * LINE_HEIGHT;
      ctx.fillText(lines[i] ?? "", centerX, y);
    }
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
 * Break sign text into rendered lines matching the game: split on explicit
 * `\n`, then greedily word-wrap each paragraph at the usable width using canvas
 * `measureText`, hard-breaking any single word that is wider than the usable
 * width.
 */
function layoutSignLines(
  ctx: CanvasRenderingContext2D,
  text: string,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }
    wrapParagraph(ctx, paragraph, lines);
  }
  return lines;
}

function wrapParagraph(
  ctx: CanvasRenderingContext2D,
  paragraph: string,
  out: string[],
): void {
  const words = paragraph.split(" ");
  let current = "";

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (measure(ctx, candidate) <= USABLE_WIDTH) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      out.push(current);
      current = "";
    }
    // The word alone may still be wider than the line; hard-break it.
    if (measure(ctx, word) <= USABLE_WIDTH) {
      current = word;
    } else {
      current = hardBreakWord(ctx, word, out);
    }
  }

  if (current.length > 0) out.push(current);
}

function hardBreakWord(
  ctx: CanvasRenderingContext2D,
  word: string,
  out: string[],
): string {
  let segment = "";
  for (const char of word) {
    const candidate = segment + char;
    if (measure(ctx, candidate) <= USABLE_WIDTH || segment.length === 0) {
      segment = candidate;
    } else {
      out.push(segment);
      segment = char;
    }
  }
  return segment;
}

function measure(ctx: CanvasRenderingContext2D, value: string): number {
  return ctx.measureText(value).width;
}
