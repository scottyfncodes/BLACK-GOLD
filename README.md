# BLACK GOLD

An industrial empire tycoon and drilling simulator that runs from 1890s petroleum wildcatting to interplanetary resource extraction.

Start with one wooden derrick and a cable-tool rig in Southeast Texas. Read the ground, lease the land, drill, and build a company that ends up inventing the future.

## Status

**Casing and hired drillers.** Set up to three telescoping strings of casing, seated where they seal or merely steady the hole; hire drillers whose ability shows only in their work and whose advice comes only from what they can see, including when a costly hole should be plugged (the call is always yours). **Leases, the ledger and the bank.** Lease the land from its owner, drill, cap the oil and sell it each month, and borrow against what the company owns, all through one double-entry ledger in whole cents. An idle rig stops the clock instead of eating the company; a failed well leaves a way back through contract drilling when one exists, and a company with none is told so plainly. **First Gusher: drilling is playable.** Stake a well, raise the derrick, work the temper screw in rhythm, bail samples, and bring in oil before the money runs out. Built on **M1 (The ground):** A playable prospect: seeded salt-dome geology hidden from the player, fieldwork that turns it into evidence, and the Geologist's Plate: a published 1890 map with the company's knowledge in carmine, and sections built only from what is known. The design and build plan are in [`docs/DESIGN.md`](docs/DESIGN.md); the art direction is in [`docs/ART-DIRECTION.md`](docs/ART-DIRECTION.md).

| Phase | Scope | State |
|---|---|---|
| 0: Foundation | Deterministic sim core, clock, persistence, minimal shell | Done (M0) |
| 1: First Oil | Playable 1890 Southeast Texas cable-tool slice | M1 (the ground), the rig, and M2 (leases, ledger, bank) built; next M4, reservoirs and production |
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
| `src/sim/` | The simulation. Pure and deterministic: no DOM, no wall clock, no `Math.random` (enforced by lint). Geological truth lives in `sim/geology/truth` and is sealed: only `sim/` and the dev god view may import it. |
| `src/app/` | Browser runtime: real time → game time, saves (IndexedDB, gzip, file export and import). |
| `src/ui/`, `src/render/` | Preact screens and the plate renderer (`render/plate`). They see the published map and `sim/knowledge`, never truth; a draw-call test proves it. |
| `src/content/` | Static data, such as real 1890 geography. |
| `tests/` | Unit, determinism (golden hash), save-format, architecture-boundary and end-to-end tests. |

### Rules that keep the simulation honest

- Every change to the world is a command or a scheduled event. Same seed and same commands give the same world, and `tests/determinism` proves it with a golden hash.
- Randomness comes from named seeded streams or pure keyed hashes, never `Math.random`.
- Changing the save shape means bumping `SCHEMA_VERSION` and adding a migration plus a test (`src/app/save/format.ts`).
