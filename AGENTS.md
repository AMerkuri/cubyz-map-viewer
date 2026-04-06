# Cubyz Map Viewer – Agent Development Guide

## Overview

Interactive 2D (Leaflet) + 3D (Three.js) web-based map viewer for Cubyz game save files. Parses binary `.surface` and `.region` files, renders terrain tiles, and displays player positions. TypeScript throughout, ESM modules.

**Important:** This project reads Cubyz save data but **must not modify any Cubyz source files** outside `cubyz-map-viewer/`. Cubyz source is read-only reference for binary format understanding.

---

## Build & Run

```bash
npm run dev              # Start both servers (backend + frontend) concurrently
npm run dev:server       # Backend only (Express on :3001, hot-reload via tsx)
npm run dev:client       # Frontend only (Vite on :5173, proxies /api to :3001)
npm run build            # Production build (vite build + tsc server)
npm start                # Run production server (after build)
```

CLI options for the server:
```bash
# Specify save path (default: auto-detects most recent in ~/.cubyz/saves/)
SAVE_PATH=~/.cubyz/saves/Save1 npm run dev:server
# Or via CLI arg
npx tsx src/server/index.ts --save ~/.cubyz/saves/Save1
```

### Testing

No test runner is configured. Verify changes manually:
```bash
curl http://localhost:3001/api/health
curl http://localhost:3001/api/world
curl -o tile.png http://localhost:3001/api/tiles/1/8/3.png
```

---

## Architecture

### Server (`src/server/`)

Three layers: **API → Parsers → Services → Response**

- **`api/`** — HTTP handlers, param validation, response formatting
- **`parsers/`** — File I/O, binary decoding, ZON parsing. No HTTP awareness
- **`services/`** — Business logic: color mapping, tile rendering, caching

Server entry (`index.ts`) initializes in sequence: paths → world meta → palettes → biomes → color map → cache → routers → listen.

**Router factory pattern** — each API module exports `create*Router(deps)`, dependencies via closure:
```typescript
export function createTilesRouter(
  savePath: string,
  colorMap: ColorMapService,
  tileCache: LRUCache<string, CachedTile>,
): Router {
  const router = Router();
  router.get("/:lod/:x/:y.png", async (req, res) => { /* uses closure deps */ });
  return router;
}
```

### Client (`src/client/`)

React 19 function components, custom hooks, local state only (no Redux/Context). Leaflet and Three.js managed imperatively via `useRef` + `useEffect`.

```
App (view state, cursorPos)
├── useWorldData()  → { worldData, surfaceIndex, loading, error }
├── usePlayers()    → PlayerData[]
├── Map2D | Map3D   (receives data as props)
├── ViewToggle
└── InfoPanel
```

### Key Domain Constants

- **MAP_SIZE** = 256 (surface tile size in blocks)
- **LODs**: 1, 2, 4, 8, 16, 32
- **Binary data is big-endian**
- **Compression uses raw deflate** (not zlib-wrapped) — use `inflateRawSync()`
- **Coordinate system**: X,Y = horizontal, Z = vertical (up)

---

## Code Style

### Formatting

- **2-space indentation** (spaces, not tabs)
- **Double quotes** everywhere — strings, imports, JSX attributes
- **Semicolons** always
- **Trailing commas** in multi-line objects, arrays, parameters, imports
- K&R brace style (opening brace on same line)
- No hard line limit; keep lines under ~120 chars when reasonable

### Naming Conventions

| Category | Convention | Examples |
|---|---|---|
| Files (non-component) | `kebab-case` | `binary-reader.ts`, `color-map.ts` |
| React components | `PascalCase` | `Map2D.tsx`, `InfoPanel.tsx` |
| Functions/variables | `camelCase` | `parseSurfaceFile`, `savePath` |
| Constants | `UPPER_SNAKE_CASE` | `MAP_SIZE`, `VALID_LODS`, `WATER_COLOR` |
| Types/interfaces/classes | `PascalCase` | `SurfaceData`, `BinaryReader`, `RGB` |
| Props interfaces | `PascalCase` + `Props` | `Map2DProps`, `ViewToggleProps` |
| Router factories | `create*Router` | `createTilesRouter` |
| React hooks | `use*` | `useWorldData`, `usePlayers` |
| Unused params | `_` prefix | `_req`, `_neighborInfo` |

### Imports

- **Named exports only** — no default exports anywhere in the codebase
- **`.js` extension required** on all local imports (ESM)
- **`import type`** for type-only imports
- **Inline `type` keyword** within mixed imports: `import { Router, type Request } from "express"`
- **No path aliases used** — use relative paths despite `@server/*`/`@client/*` being configured
- No function aliasing — a bare function name must mean it's locally defined

```typescript
import { join, resolve } from "path";
import { existsSync, statSync } from "fs";
import type { ColorMapService } from "../services/color-map.js";
import { MAP_SIZE, type SurfaceData } from "../parsers/surface.js";
```

### TypeScript Patterns

- **`strict: true`** — full strictness, `ES2022` target
- **Interfaces** for object shapes; **`type`** only for unions/complex types
- **`ReturnType<typeof hook>`** to derive component prop types from hooks
- **Tuples** for fixed-length arrays: `spawn: [number, number, number]`
- **Generics** on utility classes: `LRUCache<K, V>`
- Avoid `any` — use `as` type assertions sparingly, only when parser output types are dynamic

### Error Handling

- **Try/catch at API route boundaries** — log with `console.error`, return graceful fallback (empty tile, empty array, default data)
- **`console.warn`** for non-critical parse failures (bad biome file, bad player file)
- **`throw new Error`** only for fatal/unrecoverable issues (invalid save dir, unsupported format version)
- **`.catch(() => fallback)`** inline for optional filesystem operations
- **Client:** store errors in state via `setError()`, display in UI
- **Empty catch** only when explicitly non-critical (comment explaining why)

### Async

- **`async/await`** is the standard pattern — avoid raw `.then()` chains
- **`Promise.all`** for parallel independent fetches
- Exception: `.then()` is acceptable inside `useEffect` when you can't make the effect async

### Comments

- **JSDoc `/** */`** for module-level headers and exported function/method documentation
- **Inline `//`** for implementation notes (coordinate math, format explanations)
- Explain **why**, not what — prefer descriptive names over comments
- Format explanations in parsers are valuable and should be kept

### React Patterns

- **Function components only** — no class components
- **Named exports** for all components
- **Inline styles** — no CSS files, no CSS-in-JS, no Tailwind
- **`useRef`** for imperative library instances (Leaflet map, Three.js renderer)
- **`useEffect`** cleanup functions must dispose all resources (removeEventListener, clearInterval, renderer.dispose)
- Guard against double-init with ref flags (`loadedRef`, `initializedRef`)

---

## Cubyz Binary Formats (Quick Reference)

- **Surface** (`maps/{lod}/{wx}/{wy}.surface`): `[u8 ver=1][u8 neighborInfo][raw deflate]` → biomes_u32 + heights_i32 + origHeights_i32, each 256×256
- **Region** (`chunks/{lod}/{wx}/{wy}/{wz}.region`): `[u32 ver][u32 size][u32×64 chunkLens][chunks...]`, compression algo byte per chunk
- **Palettes** (`palette.zig.zon`): ZON arrays, index = numeric ID. Block textures: 16×16 PNGs in `assets/cubyz/blocks/textures/`
- **Players** (`players/N.zon`): ZON with `entity.position`, `name`, `gamemode`
