# BLACK GOLD

An industrial empire tycoon and drilling simulator that runs from 1890s petroleum wildcatting to interplanetary resource extraction.

Start with one wooden derrick and a cable-tool rig in Southeast Texas. Read the ground, lease the land, drill, and build a company that ends up inventing the future.

## Status

**M0 (Foundation) complete.** A deterministic simulation core, versioned saves and a minimal shell are in place: date, speed controls, the 1890 region map, and campaign save/load. The design and build plan are in [`docs/DESIGN.md`](docs/DESIGN.md).

| Phase | Scope | State |
|---|---|---|
| 0: Foundation | Deterministic sim core, clock, persistence, minimal shell | Done (M0) |
| 1: First Oil | Playable 1890 Southeast Texas cable-tool slice | Next: M1, the ground |
| 2: Industrial Expansion | Rotary, mud, multiple rigs, research, competitors | Designed at outline level |
| 3+ | Directional, modern, speculative eras | Vision only |

## Development

Requires Node 20.19+.

```sh
npm install
npm run dev          # local dev server
npm run ci           # typecheck, lint, unit tests, build, bundle budget
npm run test:e2e     # Playwright end-to-end (iPhone 13 + desktop) against the production build
```

### Layout

| Path | What lives there |
|---|---|
| `src/sim/` | The simulation. Pure and deterministic: no DOM, no wall clock, no `Math.random` (enforced by lint). |
| `src/app/` | Browser runtime: real time → game time, saves (IndexedDB, gzip, file export and import). |
| `src/ui/`, `src/render/` | Preact screens and Canvas renderers. They read the subsurface only through `sim/knowledge`. |
| `src/content/` | Static data, such as real 1890 geography. |
| `tests/` | Unit, determinism (golden hash), save-format, architecture-boundary and end-to-end tests. |

### Rules that keep the simulation honest

- Every change to the world is a command or a scheduled event. Same seed and same commands give the same world, and `tests/determinism` proves it with a golden hash.
- Randomness comes from named seeded streams or pure keyed hashes, never `Math.random`.
- Changing the save shape means bumping `SCHEMA_VERSION` and adding a migration plus a test (`src/app/save/format.ts`).
