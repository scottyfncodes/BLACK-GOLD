# BLACK GOLD: Foundation Design

> Lead design, simulation architecture and technical direction for the first build.
> This document turns the master prompt into decisions. Where it disagrees with the prompt, it says so and explains why.

**Contents**

1. [Critical evaluation](#1-critical-evaluation)
2. [Technology stack and rendering](#2-technology-stack-and-rendering)
3. [Foundational architecture](#3-foundational-architecture)
4. [Minimum viable models](#4-minimum-viable-models)
5. [Phase 1 vertical slice: "The Big Hill, 1890"](#5-phase-1-vertical-slice-the-big-hill-1890)
6. [Milestone plan and acceptance criteria](#6-milestone-plan-and-acceptance-criteria)
7. [What we are not building yet](#7-what-we-are-not-building-yet)
8. [As-built notes](#8-as-built-notes)
9. [Open decisions](#9-open-decisions)

---

## 1. Critical evaluation

### The concept's real strengths

**1. Truth vs. knowledge is the best idea here, and it should be the spine of the game.**
Separating geological truth from player knowledge turns the subsurface into an information game, closer to poker than to a resource counter. Every tool the player gets across 260 years (bailer samples, drift indicators, electric logs, seismic, MWD, LWD) is the same thing: a better instrument for shrinking the gap between what is down there and what you believe is down there. That gives the whole timeline one coherent progression axis that isn't "+10% efficiency". It answers pillar C on its own terms.

**2. The arc from operator to executive matches real history.**
The 1890s operator really did stand on the rig floor. The 2020s operator really does run 40 rigs from a dashboard. The change from tactile to managerial play isn't a contrivance. It's what happened, so it will feel right.

**3. Directional uncertainty is new ground for games.**
Three positions (actual, estimated and last surveyed) with delayed feedback is an original mechanic. Very few games simulate acting on stale information about your own tool. Navigating blind is a strong fantasy.

**4. History supplies emergent drama for free.**
Southeast Texas in 1890 already contains a perfect tutorial arc: cable tools fail in unconsolidated Gulf Coast sands, rotary rigs with drilling mud succeed, overdrilling under the rule of capture collapses reservoir pressure, and the price falls through the floor. We don't need to script any of it. If the models are honest, the player will live through it.

### The real risks, in order of severity

| # | Risk | Why it is dangerous | Mitigation |
|---|---|---|---|
| R1 | **Scope.** Six eras, five scales, 260 years. | Each era is close to a separate game. The usual way this fails is a broad, shallow sim where no era is good. | Ship Era I as a complete, fun game before writing Era II code. The architecture leaves room for later eras but builds none of them. Eras V and VI stay vision-only until Era III is shipped. |
| R2 | **Two games competing.** A hands-on drilling sim and a tycoon pull attention against each other. | At 30 rigs, manual drilling is either mandatory busywork or irrelevant. Both kill a pillar. | Design **intervention, not operation.** Delegated wells run the *same* model under a crew controller whose skill sets its tracking error. Taking the controls is worth it only when it pays: a new formation, a first well, a crisis. The game routes those moments to the player with interrupts. |
| R3 | **Cable-tool drilling is monotonous in reality.** | Weeks of a bit going up and down is not gameplay. | Real decisions do exist: feed the temper screw, judge when to bail, dress the bit, read samples, case off water, decide when to stop. Section 4.2 builds the cockpit around those decisions and compresses time between them. |
| R4 | **Directional drilling becomes a spreadsheet.** | Inclination, azimuth, toolface and DLS can read as homework. | Build it in Phase 3 on top of a wellbore model that has existed since Phase 1 (survey stations). Teach it physically first: cable-tool holes drift crooked, so "where is my bit, really?" is a question from the first hour. |
| R5 | **Emergent tech trees become incoherent.** | Free-form research can produce nonsense, such as MWD without electronics. | Technologies are gated by a dependency graph and by **world maturity**. The company can only lead the world by bounded amounts and at real cost. Effects are new verbs and equipment, never global multipliers. |
| R6 | **Economic balance.** | Booms, busts and competitors interact chaotically. A bad tuning makes the game unwinnable or trivial. | One regional market in Phase 1. Monte Carlo balance harness from M5 onward: thousands of seeded headless runs with scripted policies, checked against target bands. |
| R7 | **Determinism in JavaScript.** | `Math.sin`, `Math.exp` and similar functions are implementation-approximated by spec, so results can differ across engines in the last bit. | Save **state snapshots**, not input replays, so cross-engine drift can never corrupt a save. Determinism is guaranteed and tested *within* a build on one engine. If replays ever need to cross engines, swap in our own polynomial approximations behind `sim/math`. |
| R8 | **Late eras as reskins.** | "Asteroid oil" with a space texture would betray the north star. | Model a planetary body as data: geology, gravity, atmosphere, logistics distance. Extraction physics stay the same, while the constraints change what is hard. No space code until there is a design that changes the verbs. |
| R9 | **Terminology wall.** | Prompt pillar F. Petroleum engineering jargon can lock players out. | Progressive disclosure: every gauge has a plain-language reading ("bit is dull, penetration falling"), and the raw number sits one level down. Jargon arrives with the tool that needs it, never before. |

### Where this design deliberately departs from the prompt

- **Competitors in Phase 1, in miniature.** The prompt puts competitors in Phase 2. Phase 1 still needs other operators, because the rule of capture (neighbours draining your reservoir) is the most important economic lesson of the era and the main driver of "the world responds". Phase 1 gets a non-agent **Rush model** (Section 4.4). Full AI companies stay in Phase 2.
- **No research UI in Phase 1.** The data model for technology exists from M0 so the architecture is right, but there is no tech-tree screen until there is something real to research. Showing one early would be exactly the hollow placeholder the prompt forbids.

---

## 2. Technology stack and rendering

### Recommendation: a web-first TypeScript game

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript (strict)** | One language for sim and UI. Types enforce the truth/knowledge boundary. |
| Build | **Vite** | Fast, standard, zero configuration for static output. |
| UI framework | **Preact** (React-compatible API, ~4 KB) | Tycoon games are mostly panels, tables and dashboards, which HTML does better than any game engine. React compatibility keeps the option to move to React later. |
| 2D rendering | **Canvas 2D**, hand-written | Paper maps, cross-sections, the derrick and walking beam, tension traces. All of it is 2D, and Canvas is enough and has no dependencies. |
| 3D (Phase 3+) | **Three.js**, lazy-loaded | Only for the 3D wellbore view. Not in the Phase 1 bundle. |
| Simulation | Pure TS modules, **Web Worker** from M3 | Keeps the UI at 60 fps during fast-forward. Runs headless in Node for tests and balance runs. |
| Persistence | **IndexedDB** (thin hand-written wrapper) + file export | Save state is gzipped JSON through the native `CompressionStream`. No library. |
| Audio | Web Audio API | Engine thump, cable slap and steam. Assets come from GITCRAFT's audio department. |
| Tests | **Vitest** for the sim. **Playwright** for end-to-end smoke tests and screenshots | Numerical and economic systems get unit and property tests, per rule 15.5. |
| Hosting | **Static hosting with per-PR preview URLs** (Vercel recommended) | Every PR gets a live link, which matches how you review work. No server and no database. |

Runtime dependencies at Phase 1: **Preact only.** Everything else is a dev dependency.

### Alternatives considered

- **Godot / Unity.** Stronger for 3D and console, weaker for dense data UI. Web export is heavy (multi-MB WASM), and a live link per change becomes painful. Revisit if the game ever pivots toward 3D-first presentation. The sim core is engine-agnostic TS, so a port wouldn't rewrite the simulation.
- **ECS framework (bitECS etc.).** Unnecessary. We have hundreds of entities, not hundreds of thousands. Normalized plain objects keyed by ID are simpler and serialize trivially.
- **A backend.** Not needed for a single-player game. It adds cost, accounts and operations for no player benefit.

Desktop distribution, if wanted later, is a Tauri wrapper around the same build.

---

## 3. Foundational architecture

### 3.1 Module layout

```
src/
  sim/                 # Pure, deterministic. No DOM, no Date, no Math.random, no I/O.
    core/              # clock, scheduler, rng, commands, events, state, hashing
    math/              # units, interpolation, deterministic helpers
    geography/         # persistent real-world map data (rivers, towns, rail)
    geology/           # seeded truth generator + truth queries (sealed)
    knowledge/         # what the company knows; evidence records
    land/              # parcels, owners, leases, terms
    wells/             # wellbore geometry, drilling models, lifecycle
    reservoir/         # tank models, production, interference
    economy/           # markets, prices, ledger, loans, transport
    world/             # other operators (Rush model), regional events
    tech/              # technology graph, world vs company maturity
    company/           # cash, assets, crews, policies
  content/             # Pure data: basins, formations, equipment, techs, prices (typed)
  app/                 # Worker host, save/load, sim <-> UI bridge
  ui/                  # Preact screens and panels (read knowledge only)
  render/              # Canvas renderers (map, section, rig, gauges)
  audio/
tests/
  sim/                 # unit + property tests
  determinism/         # seed+commands -> state hash golden tests
  balance/             # headless Monte Carlo runs (not in CI by default)
  e2e/                 # Playwright smoke
```

**Hard boundaries, enforced by lint rules (`no-restricted-imports`):**

- `sim/**` cannot import `ui`, `render`, `app` or any browser API.
- `ui/**` and `render/**` cannot import `sim/geology/truth`. They read the subsurface **only** through `sim/knowledge`. This makes the truth/knowledge separation a compile-time guarantee rather than a convention. A dev-only `debug/godview` is the single exception, stripped from production builds.

### 3.2 The simulation contract

```ts
// Everything the player (or a crew controller, or a rival) does is a Command.
type Command = { t: GameTime; actor: ActorId; type: string; payload: unknown };

// The sim is a pure step function over serializable state.
function step(state: WorldState, until: GameTime, commands: Command[]): {
  state: WorldState;
  events: SimEvent[];        // log, notifications, interrupts
};
```

- **State is plain data.** Normalized records keyed by string IDs, with no class instances, closures or `Map`s in saved state. `structuredClone`-safe and JSON-safe.
- **Commands are the only way to change state.** UI dispatches commands. It never mutates.
- **Events flow out.** Each event has a severity, and `interrupt: true` events stop fast-forward.
- **State hash.** A stable hash of canonicalized state runs after each step in tests. Same seed plus same command log gives the same hash. This is the determinism test.

### 3.3 Time: discrete events, not one global tick

Game time is an **integer count of minutes since 1890-01-01 00:00**. A 53-bit safe integer covers more than 17 billion years, so the 2150+ eras fit.

A **priority-queue scheduler** advances to the next due event. Systems schedule themselves at their natural rate:

| System | Rate while active | Rate while delegated or distant |
|---|---|---|
| Drilling (player at controls) | 1-minute substeps, frame-interpolated | n/a |
| Drilling (delegated) | 1-hour steps, crew controller | per-day analytic |
| Production and reservoirs | daily | daily |
| Ledger: wages, fuel, sales | daily accrual, monthly statements | same |
| Markets and prices | weekly | weekly |
| Rush model and other operators | weekly | weekly |
| Technology and world research | monthly | monthly |
| Civilization layer (Phase 4+) | yearly | yearly |

The player's speed control (Pause, 1×, 4×, 16×, and **"Until something happens"**) maps real seconds to game time. "Until something happens" jumps from interrupt to interrupt. That is how a two-month cable-tool well stays playable.

### 3.4 Randomness: named streams, counter-based

- The world seed is a 64-bit value shown to the player and shareable.
- `rng(seed, "geology", basinId, cellX, cellY)` is a **counter-based hash** (SplitMix64 or PCG output on a hashed key). The same key always gives the same value, regardless of generation order. Geology can be generated lazily and in any order, and it never changes when other systems consume randomness.
- Stateful streams for runtime events, such as `rng.stream("drilling:well-17")`, are seeded from the world seed plus the stream name and stored in state.
- Adding a new random consumer in one module **cannot** perturb another module's outcomes, so old seeds stay meaningful across patches wherever possible.

### 3.5 Level of detail

One model per phenomenon, integrated at different resolution. There are no separate "fake" models for delegated work:

- **Active well:** full drilling state, minute substeps, player input.
- **Delegated well:** same equations, hourly steps, inputs from a **crew controller** (a policy plus a skill-dependent tracking error).
- **Other operators' wells:** statistical model. Expected days-to-depth and outcome sampled from the *same geology truth*, so their dry holes and discoveries are physically consistent with yours.

### 3.6 Persistence

- Save = `{ format, schemaVersion, buildId, savedAt, world }`, gzipped. The seed lives in the world. A command-log tail for bug reports is added when there are player commands worth logging.
- **Migrations** are an ordered list of pure functions `vN → vN+1`. Old saves load forever, and there is a test for every migration.
- Autosave on month boundaries and before risky operations (a gusher, running casing). Three rolling slots plus manual saves. Export and import as a `.blackgold` file.

### 3.7 Units

Internally **SI** (m, m³, Pa, kg, s). The display defaults to period oilfield units (feet, barrels, psi, dollars) with a toggle. One `sim/math/units.ts` owns every conversion. This prevents the most common class of simulation bug.

---

## 4. Minimum viable models

Each model below is the *minimum that produces meaningful decisions*. Each states what the player decides, what the model computes, and what is deliberately left out.

### 4.1 Geology (truth)

**Representation: a layer-cake over a 2D grid, not voxels.**
A basin is a stack of **formations**. Each formation's top depth is a function of map position (x, y), built from a few deterministic components:

```
top_i(x, y) = regionalTop_i
            + regionalDip · (x, y)          // Gulf Coast: gentle coastward dip
            + Σ domeUplift_d(x, y) · w_i    // salt domes punch up through the stack
            + Σ faultThrow_f · side_f(x, y) // radial and growth faults around domes
            + noise_i(x, y)                 // low-amplitude, seeded
```

Each formation carries: lithology (clay, sand, gravel, limestone, anhydrite caprock, salt), drillability, abrasiveness, porosity φ, permeability k, consolidation (does it heave or cave?), and water-bearing or not.

**Salt domes, the Southeast Texas trap.** Each dome has a seeded position, radius, crest depth and caprock thickness. Traps form in the **caprock** and in **flank sands** pinched against the salt. Hydrocarbons exist only where a trap exists **and** charge reached it:

- Each dome's charge comes from a regional source-maturity field plus a seeded migration efficiency, giving a fill fraction from 0 (barren) to 1 (filled to spill point).
- The oil-water contact sits at `spillDepth − fill · columnHeight`. Oil exists only above it and only inside reservoir-quality rock.
- A gas cap forms above a gas-oil contact when charge is gas-prone.

**Surface expression.** A filled, shallow dome uplifts the surface into a low **mound** and leaks **gas seeps, sour springs and paraffin dirt**. This is real (Spindletop was literally "Big Hill"), and it makes 1890 exploration a reading of the land instead of a guess. A barren dome can still make a mound. Seeps only come from charged ones, though they can be faint.

**Validation tooling:** the dev god-view draws true cross-sections. A statistical test over 1,000 seeds asserts that oil is found **only** inside traps, that charged-dome frequency sits in a target band (roughly 20–35% of domes), and that exploration commands never change any truth value.

*Left out for now:* seismic velocity, diagenesis, reservoir heterogeneity below formation scale, multiple basins, and stratigraphic traps outside the dome setting.

### 4.2 Knowledge (what the company believes)

Knowledge is a log of **evidence records**, each with a source, a location, a time and an uncertainty:

```ts
type Evidence =
  | { kind: "surfaceSign"; parcel; sign: "gasSeep" | "sourSpring" | "paraffinDirt" | "mound"; strength }
  | { kind: "sample"; wellId; depthTop; depthBase; lithology; show: "none" | "trace" | "good" | "flow" }
  | { kind: "drillerLogEntry"; wellId; depth; note }           // the historical driller's log
  | { kind: "opinion"; source: "geologist" | "dowser" | "townGossip"; parcel; claim; reliability }
  | { kind: "offsetWell"; ownerId; parcel; outcome; publicDepth }; // rumours of others' wells
```

The UI builds **interpretations** from evidence: correlated formation tops between wells and a contoured "believed structure". Players can draw their own correlations. **Interpretations can be wrong**, and that is the game.

Each evidence source has a defined noise model. A bailer sample's lithology call is accurate, but its depth is smeared over the bail interval. A geologist's opinion is right with probability tied to their skill and to the era's theory (salt-dome geology isn't understood yet in 1890). Gossip is cheap and unreliable.

### 4.3 Drilling: cable tool (Phase 1)

**State per well:** depth, hole diameter, bit sharpness (0–1), cuttings fill height, water in hole, casing strings `[{ depth, diameter }]`, line length paid out, temper screw position, deviation (inclination drift), and equipment condition.

**Penetration per blow:**

```
Δdepth = k · E_blow · sharpness / (drillability · (1 + c · fillHeight))
E_blow ∝ toolWeight · strokeLength · effectiveContact(feed)
```

- **The temper screw is the core tactile control.** The driller pays out line as the hole deepens. `effectiveContact` peaks when the tools just reach bottom at full stroke. **Under-fed:** the tools fall short and blows are wasted. **Over-fed:** the line goes slack, energy is lost, and the hole drifts crooked (deviation grows with slack, steeper in dipping beds). The cockpit shows a **line-tension trace** for "feeling the line". A good rhythm looks like a crisp sawtooth.
- **Cuttings cushion the blows,** so penetration falls as fill rises. The player decides when to **bail**. Bailing takes time proportional to depth, and **each bail returns a sample**, which is the main source of knowledge. This tension is the core loop: keep drilling, or stop, bail and learn.
- **The bit dulls** with blows times abrasiveness. **Dressing** means pulling the tools and having the tool dresser forge the bit, which costs time that grows with depth.
- **Casing and telescoping.** Water-bearing or caving zones must be cased off. Each casing string forces a **smaller hole diameter** below it. Run out of diameters and the well can't go deeper. This was a real constraint, and it makes casing points a strategic decision.
- **Gulf Coast heaving sands.** Unconsolidated sands flow into an uncased hole. Cable tools struggle badly here, which is historically true. Mitigations are driving casing as you go (slow and costly) or later technology. **This is the in-fiction reason rotary drilling with mud matters** and the bridge to Phase 2.

**Failures are causal, never dice for their own sake.** Each has a hazard rate driven by state, and each logs its cause:

| Failure | Driven by | Consequence |
|---|---|---|
| Stuck tools | Caving formation, high fill, slack line, crooked hole | Fishing job (jars, spears) or skid the rig and start over |
| Lost or parted line | Line wear plus shock loading from slack | Fishing job |
| Cave-in | Uncased unconsolidated rock, time open | Fill, stuck risk, possible lost hole |
| Boiler trouble | Low water, poor maintenance, crew fatigue | Downtime. Rarely an explosion, with crew injury |
| Blowout / wild gusher | Pressured zone, no control equipment | Lost oil, fire risk, cleanup, but also proof of a big reservoir |
| Crew injury | Pace policy, fatigue, crew skill, night tours | Crew loss, morale, wages |

Every failure's **cause appears in the driller's log**, so players learn rather than resent.

**Wellbore geometry from day one** is a list of survey stations `(MD, inclination, azimuth)` with minimum-curvature interpolation. A cable-tool well has stations the company *cannot see* (no drift indicator exists yet), but they are in the truth. Phase 3's directional drilling, with actual, estimated and last-surveyed positions, extends this model rather than replacing it.

### 4.4 Reservoirs, production and the Rush

**Tank model per trap compartment** (one per dome flank or caprock zone):

```
N    = A · h · φ · (1 − Sw) / Bo                 // oil in place
p    = p_i · (1 − Np / (N · r_drive))            // pressure falls with withdrawal
q_w  = PI_w · max(0, p − p_wf)                   // each well's rate
PI_w ∝ k · h / μ                                 // from the formation at that well
waterCut rises as the cumulative-withdrawal-implied contact approaches the perforations
```

- Decline curves **emerge** from depletion. They are not scripted Arps curves.
- **All wells in a compartment share one tank**, whoever owns them. Your neighbour's wells drain your oil. That is the **rule of capture**, and it's the strategic heart of Era I: lease the whole structure, or drill fast before others do, knowing that drilling fast destroys the field's pressure.
- **Gushers** happen when `p` exceeds the hydrostatic head of the fluid in the hole. Spectacular, wasteful, and a strong signal to everyone nearby.

**The Rush model (Phase 1 stand-in for competitors).**
News of a discovery spreads by distance and time. Lease asking prices on nearby parcels rise. Other operators lease and spud wells at a rate driven by the expected value they can *observe*: public shows, gushers and the price of oil. Their wells use the same geology truth and the same tank, so they drain shared compartments for real. When prices crash or a field disappoints, the Rush reverses. There are no personalities or strategies yet. Those come in Phase 2.

### 4.5 Economy (Phase 1)

- **Ledger:** double-entry from M2 onward, with cash, assets at cost, depreciation, accruals, a monthly statement and a cash-flow forecast. A small company dies from cash flow, not losses, and the forecast shows that.
- **Costs:** lease bonus per acre, **1/8 royalty** (the historical standard), rig purchase or hire, derrick construction (timber plus rig-builder days), wages per tour (driller and tool dresser, the historical two-man cable-tool crew), fuel and water for the boiler, casing per foot, and fishing jobs.
- **Lease terms:** primary term with a **drill-or-pay delay rental** clause. An undrilled lease either costs money or lapses, which creates real time pressure.
- **Oil price:** one regional market. `price = basePrice · (demand / supply)^(−1/ε)` with slow-moving demand and supply from *every* well in the region (yours plus the Rush). A big field genuinely crashes the price.
- **Transport bottleneck:** the oil has to get to the railhead at Beaumont. Without storage you lose oil from earthen pits (evaporation, fire, seepage). Options: wooden tanks, teamster wagons (costly per barrel), or a pipeline (capital-heavy). Field price equals the railhead price minus transport cost. This makes infrastructure matter from the first barrel.
- **Finance:** a bank loan against proven reserves, so discovering oil literally raises your credit limit. Interest accrues monthly. Default leads to repossession.

*Left out for now:* stock markets, multiple commodities, refining, taxes beyond a flat figure, inflation, M&A.

### 4.6 Technology (data model and gameplay from Phase 2)

```ts
type Tech = {
  id; discipline: "mechanical" | "measurement" | "geoscience" | "materials" | "energy" | "computing";
  requires: TechId[];                    // dependency graph
  stages: [theory, experimentation, breakthrough, commercialization, maturity];
  grounding: "historical" | "speculative";   // rule 15.7, shown to the player
  unlocks: Verb[] | EquipmentId[];       // new actions or equipment, never "+x%"
};
type TechProgress = { world: Stage + progress; company: Stage + progress; licensedFrom?: ActorId };
```

- **World maturity** advances from aggregate research by universities, manufacturers and rivals, at a pace anchored loosely to history but nudged by in-game demand. If the Gulf Coast booms, rotary matures faster.
- **Company progress** comes from research spend times relevant staff expertise times facilities. The company can lead the world by a bounded margin, at steep cost.
- **Acquisition paths:** research it, license it (once the world reaches commercialization), buy equipment (once it reaches maturity), or keep using the old technology.
- **Failed experiments** produce **evidence** (knowledge about the tech), which raises the success chance of the next attempt.

---

## 5. Phase 1 vertical slice: "The Big Hill, 1890"

### Setting

Jefferson County, Southeast Texas, spring 1890, a few miles south of Beaumont. **Persistent real geography:** the Neches River, the town of Beaumont, the rail line through it, the coastal prairie and marsh. **Seeded geology:** three to five salt domes in a roughly 25 × 25 km map. One of them *might* be a giant. On some seeds the great field is under a different hill. On others, none of the domes is worth much.

Characters are fictional. Real places are used. No real historical people are portrayed.

### The player starts with

- About $4,000 (1890 dollars) and a small line of credit
- One used **cable-tool rig** (engine, boiler, bull wheel, walking beam, tools), with no derrick yet
- A **driller** and a **tool dresser** (named, with skills: line feel, tool dressing, safety, experience per lithology)
- A paper map of the region with roads, the railhead and known landowners

### The loop the slice must deliver

1. **Read the land.** Ride out to parcels and observe: mounds, gas seeps, sour springs, paraffin dirt. Hire a geologist (skeptical and expensive) or listen to gossip (cheap and unreliable). Evidence appears on the paper map as ink annotations.
2. **Lease.** Negotiate with landowners on bonus per acre, royalty and term. Prices respond to rumours and to the Rush.
3. **Rig up.** Hire rig builders to raise a wooden derrick (days, timber cost). Haul the boiler. Secure water.
4. **Drill (the cockpit).** A side view of the derrick and walking beam, the line-tension trace and the temper screw control. Decide when to bail, dress the bit, case off and stop. **Bailer samples** land on a sample board and write the **driller's log**, the knowledge artifact.
5. **Discover, or fail.** A dry hole still produces knowledge: formation tops and shows that update the believed structure. A show means deciding whether to test. A gusher is a spectacle, a waste, a crisis and a beacon to the Rush.
6. **Produce.** Choose storage and transport. Watch rate, pressure and water cut. Watch neighbours spud offset wells.
7. **Finance a second well.** Proven reserves raise credit. Pick the next location using what the first well taught you.

### Cockpit interaction (desktop and touch)

| Action | Desktop | Touch |
|---|---|---|
| Feed the temper screw | Hold **Space**, or drag the screw wheel | Drag the screw wheel |
| Stroke length | Scroll on the walking beam | Slider |
| Bail / dress bit / run casing / stop | Hotkeys **B / D / C / S** with buttons | Buttons |
| Hand control to the driller | **Tab** | "Let the driller run it" |

Assistance is on by default: the driller comments in plain language ("line's going slack, boss"). Experts can turn hints off and read the raw tension trace.

### Look and feel (Era I)

**Decided: B · Geologist's Plate.** The game looks like a hand-coloured plate from a state geological survey report. Every view is a numbered plate, with the section and the map as captioned figures. Watercolour washes are for land and rock only, and infrastructure is drawn in ink. The company's own knowledge is written in carmine, using the conventions geologists used for certainty, and blank paper means "not known". Set in Bodoni Moda. The rules, tokens and what is ruled out are in [`docs/ART-DIRECTION.md`](ART-DIRECTION.md). Sound is half the feel: engine thump, cable slap, the bailer's gurgle, steam.

### Slice success criterion (from the prompt, made testable)

A new player, without outside help, can **acquire a lease, explore, drill, discover oil, begin production, and finance a second well** within about 60–90 minutes of play on a seed with a discoverable field. The game also stays winnable but not trivial across the balance harness's seed set.

---

## 6. Milestone plan and acceptance criteria

Each milestone ships through a PR with a live preview link and is playable or inspectable in the browser. Each one leaves the game strictly better than before.

### M0: Foundation (Phase 0)

- Vite + TS strict + Preact scaffold, ESLint boundary rules, Vitest, Playwright, CI (typecheck, lint, test, build)
- `sim/core`: integer game time, scheduler, counter-based and stream RNG, command bus, event log, canonical state hash
- Save and load (IndexedDB plus export and import), schema versioning, migration framework
- Minimal shell: date, speed controls (pause, 1×, 4×, 16×, until-event), a region map showing real geography only (no geology yet, and nothing pretending otherwise), save and load menu

**Acceptance**
- [ ] The same seed plus the same command log gives identical state hashes after 10 simulated years (golden test)
- [ ] Save → load → continue gives a hash identical to an uninterrupted run
- [ ] An import rule in `ui/` targeting `sim/geology/truth` fails lint
- [ ] One simulated year headless runs in under 1 s in Node. The UI holds 60 fps at 16×
- [ ] The preview URL loads in under 2 s on a mid-range phone. The initial JS is under 150 KB gzipped

### M1: The ground (geology truth + knowledge)

- Gulf Coast dome generator, formation stack, traps, charge, contacts, surface signs
- Evidence store, surface observation command, dev god-view cross-sections

**Acceptance**
- [x] Across 1,000 seeds, every oil-bearing cell lies inside a trap above its contact (property test)
- [x] Charged-dome rate falls within the target band. At least 85% of seeds have one or more discoverable fields
- [x] Observation commands change knowledge and never change truth (truth hash unchanged)
- [x] The player-facing map shows only evidence-derived information

### M2: Land and money

- Parcels, owners, lease negotiation, terms and delay rentals, double-entry ledger, monthly statement, cash-flow forecast, bank loan

**Acceptance**
- [x] The ledger balances after every transaction (property test over random command sequences)
- [x] A lease lapses or charges rental on schedule
- [ ] The player can lease a parcel and see the cost reflected in the forecast (the cost shows in the cash book; the forecast is deferred, see §8)

### M3: The cockpit (cable-tool drilling)

- Drilling model, temper screw and tension trace, bailing and samples, driller's log, bit dressing, casing and telescoping, heaving sands, causal failures, crew controller for delegation, sim moved to a Web Worker

**Acceptance**
- [ ] Unit tests: penetration monotonic in sharpness and stroke energy and inverse in fill, and casing always reduces available diameter
- [ ] Skilled manual play reaches 1,000 ft meaningfully faster than a poor crew controller, and a good crew is competitive with average manual play
- [ ] Every failure event carries a cause traceable to state (test asserts no causeless failures)
- [ ] Playtest: a first-time player understands when to bail within the first 10 minutes, from hints alone

### M4: First oil (reservoir and production)

- Tank model, completion, gushers, flow to storage, water cut, shared-tank interference

**Acceptance**
- [ ] Material balance conserved: cumulative production never exceeds oil in place
- [ ] Two wells in one compartment deplete it faster than one, and each well's rate drops (interference test)
- [ ] A gusher happens only when reservoir pressure exceeds the hole's hydrostatic head

### M5: The world responds (economy + Rush)

- Regional market price model, transport and storage options, the Rush model, loan against proven reserves, headless balance harness

**Acceptance**
- [ ] A large discovery measurably lowers the regional price and raises nearby lease prices
- [ ] Rush wells drain shared compartments (shown in the player's own production numbers)
- [ ] Balance harness: across 500 seeds, a scripted competent policy finances a second well in 80–95% of runs, and a reckless policy goes bankrupt in a meaningful fraction

### M6: The slice is a game (polish and onboarding)

- Visual direction applied (maps, ledger, cockpit), audio, onboarding through the driller's voice, interrupts and "until something happens", autosave, settings, accessibility pass
- GITCRAFT **PLAYCRAFT** pass (gameplay: feel, onboarding, pacing) and **PIXELCRAFT** pass (UI on iPhone and desktop), with fixes and re-verification

**Acceptance**
- [ ] The slice success criterion (Section 5) met by fresh playtesters
- [ ] No hollow UI: every visible control is backed by simulation
- [ ] PLAYCRAFT and PIXELCRAFT top-ranked issues resolved and re-verified

### Phase 2 outline: Industrial Expansion (after M6 ships)

Rotary rig and drilling mud (the in-fiction answer to heaving sands), multiple rigs, hiring and delegation at scale, equipment maintenance, regional pipelines, the first research gameplay (rotary, mud chemistry, drift indicators), and AI operator companies replacing the Rush with agents that lease, drill, compete and can be bought out.

---

## 7. What we are not building yet

Deferring these is a decision, not an oversight. Each has an entry point already reserved in the architecture.

| Not yet | Why | Reserved hook |
|---|---|---|
| 3D wellbore view, Three.js | No directional drilling until Phase 3 | Survey-station wellbore model (M3) |
| Directional drilling: toolface, motors, MWD | Phase 3. Needs instruments to exist in-world first | Actual vs. known wellbore positions (M3) |
| World map and multiple basins | One basin has to be fun first | `basinId` in every geology key |
| Research tree UI and `tech/` model | Nothing real to research in 1890 Beaumont yet. Built with its first real technology in Phase 2 rather than as an unused M0 abstraction | System registry (M0) |
| AI corporations with strategy | The Rush model covers Phase 1 honestly | `actor` on every command |
| Employees beyond driller, dresser, rig builders, geologist | Roles must earn their place with real effects | Generic skill model |
| Offshore, horizontal, RSS, geosteering | Phases 3–4 | — |
| Eras V–VI: fusion drills, orbital, planetary | Vision only until Era III ships | Body-as-data planned in the geology schema |
| Stock market, M&A, multi-commodity, refining | Phase 4 economy | Double-entry ledger |
| Voxel or high-resolution subsurface | Explicitly out of scope by design | Layer-cake plus local detail |
| Backend, accounts, cloud saves, multiplayer, mods | No player value for a single-player slice | Export and import files |
| Environmental regulation system | Phase 2+. Pit losses and fire are the honest Era I version | Event and obligation records |
| Generic game engine or ECS | We are building one game, not an engine | — |

---

## 8. As-built notes

Where the build deliberately differs from the plan above. Each milestone appends here.

**M0 (Foundation)**

- The `tech/` data model moved to Phase 2, so the first technology arrives with real gameplay instead of an unused abstraction.
- "Until something happens" also stops at the start of the next month, because M0 has no interrupt sources yet. Real interrupts take over from M3.
- Speeds are 1× = 1 game hour per real second, 4× and 16× multiples, Skip about a month per half second. They get retuned when the cockpit (M3) needs minute-level play.
- The unit toggle (oilfield vs. SI) arrives with the first measured quantity in M1. M0 displays nothing with units except the map's scale bar.
- The 60 fps and under-2 s load criteria are measured in headless Chromium: frame rate at 16×, and load under 4× CPU and network throttling as a stand-in for a mid-range phone.

**M1 (The ground)**

- **Truth is regenerated, never saved.** Geology is a pure function of the seed and `GEOLOGY_VERSION`. The world stores only the version, and a save made by a different geology version is refused rather than reinterpreted.
- **Measured at acceptance** over a fixed set of 1,000 seeds:
  - 30% of domes are charged, inside the 20–35% band.
  - 87.6% of seeds hold a field. "Discoverable" means oil shallower than 2,500 ft, which is Era I cable-tool reach.
  - 19% of seeds print no named hill at all, so in those worlds mounds must be found on foot.
- **The Frio is a reservoir.** It is a major Gulf Coast reservoir, and treating it as non-reservoir left deep domes with no traps.
- **Addition beyond §4.2: settlers' water-well records** (evidence kind `wellRecord`). Before drilling (M3), they are the only possible subsurface evidence. They're also historically apt: water wells on Big Hill struck sulphur water and gas. Each record is the owner's memory, merged and rounded to 5 ft, in his own words.
- **Evidence kinds in M1:**
  - surface signs, with real false positives (marsh gas);
  - walked-survey records (negative evidence: examined, nothing found);
  - well records;
  - opinions (gossip, and a geologist biased by 1890 theory).
- **Not in M1:** samples, drillers' logs and offset wells arrive with drilling (M3) and the Rush (M5).
- **Interpretations are separate from evidence:** section lines and prospects, kept in their own list, which the player can rub out. Correlations in a section are inferred from the records on screen, never from truth.
- **Grants no longer straddle the Neches or cover Beaumont's townsite.** The fixed survey grid is filtered so that it doesn't.
- **Rendering is cached rather than tiled.** The renderer uses one cached print layer (rebuilt when a pan or zoom settles) plus a manuscript layer drawn every frame. That meets M1's needs, so tiles and worker rendering are deferred until frame times require them.
- **The dev god view** (`src/debug/godview.ts`, press G) loads only in development. CI fails the build if it appears in production.

**First Gusher (drilling brought forward, ahead of M2)**

- **Why the order changed.** Play-testing M1 showed the game had no fun loop: every action was a button and a timer, and the defining experience (the rig) was two milestones away. The cable-tool rig (§4.3) is now built ahead of M2's land and money. Leases, the ledger and the bank come later, folded in as far as the rig needs them.
- **Stakes, kept minimal on purpose:**
  - $1,500 to start;
  - $350 to raise a derrick;
  - $12 a day;
  - casing at $1.10 a foot;
  - $60 for a fishing job.

  Running out of money ends the well. At the time leases were not modelled and any surveyed land could be drilled; the next phase (below) requires a lease.
- **Drilling model.** Penetration depends on how squarely the tools strike, which the player sets by feeding the temper screw, and on the rock at the bit (truth), the bit's sharpness and the cuttings cushion. Uncased sands heave in. Stuck tools come from slack, caving and dirty holes, and every stuck event carries its cause. Bailing returns a sample, which is evidence. A gusher happens only where the truth holds oil or gas (tested).
- **Pace.** About 60 ft a day in practice, which is period-plausible. From a well-chosen site, the automatic driller brings in about 75% of wells within budget; the failures are deep pays where the money runs out short of the oil. Manual play with good rhythm is faster.
- **The rig view** is an animated plate drawn on canvas, with sound synthesized through Web Audio, so there are no asset files:
  - the derrick goes up in stages while rigging;
  - walking beam, band wheel, engine house, the crew at work, and the site around them;
  - a sun or moon crossing the sky with the hour, casting the derrick's shadow;
  - a cutaway inked only from bailer samples, with blank paper below the bit;
  - the driller's log written up as you go;
  - oil and gas blowouts drawn differently.
- **The living map:** daylight, Beaumont's mill smoke, the train, the field party riding the survey it is walking, the company's derricks in ink, and oil staining the paper where a well came in.
- **Time at the rig.** 1× is ten game minutes a second, so the feed rhythm is playable. Operations (bailing, dressing, casing, fishing) fast-forward. Stuck tools, a gusher or a dry hole pause the game.
- **Guidance.** The plate states the goal ("Bring in a well before the money runs out.") and one plain next step.

**Leases, the ledger and the bank (M2, built on the rig)**

- **One financial model.** Every dollar moves through an append-only, double-entry ledger in whole cents (`sim/company/ledger.ts`). Cash, debt and every balance are derived from the entries; nothing else stores money. An entry that does not balance, or is not whole cents, is refused.
- **Step-size independence.** Money moves only at scheduled events, never in proportion to a frame or a step:
  - rig time accrues per tick and is entered once a day at midnight;
  - oil is produced daily and sold on the 1st for the month before;
  - interest accrues each midnight in exact integer units (1/36,500 of a cent) and is charged on the 1st, with the fractions carried over.

  Tests run the same campaign at steps of 1 minute, 1,439, 1,440 and 1,441 minutes, 9 days and a 500-day jump, and require byte-identical books. One property test plays random command sequences and checks that the books balance after every transaction and that neither cash nor debt goes negative.
- **Leases** (`sim/company/leases.ts`):
  - one year, one-eighth royalty, from public information only. The price rises near a printed hill, near Beaumont and near the company's own strikes. A test changes the hidden geology and gets identical terms.
  - The owner's asking price, or one lower offer at three quarters. Each owner has a fixed temperament, and a refusal stands for 30 days.
  - A lease is held while a well is drilled or producing on it. Otherwise it is renewed on a delay rental if the cash is there, or it lapses.
  - Drilling requires a lease.
- **Minimal production** (`sim/company/production.ts`), not the M4 reservoir model:
  - capping an oil gusher costs $80;
  - wagons haul at most 150 bbl a day;
  - the flow declines with what has been drawn from the trap;
  - oil sells at 60¢ a barrel at the railhead, less 20¢ hauling and the royalty.

  Gas has no buyer in 1890. Uncapped gushers earn nothing. Gusher and victory behaviour are unchanged; capping is a separate, deliberate step.
- **The bank** (`sim/company/bank.ts`): the First National Bank of Beaumont lends three quarters of the value of the rig and the producing wells (half, as first built; see the revision below), in $50 steps, at 8% a year. Discovering oil raises the credit limit. The player can repay at any time.
  - **Default.** One unpaid month brings a warning, and the interest is added to the loan. Two in a row bring foreclosure:
    - the bank takes the rig and sets its value against the loan, paying back any surplus;
    - a well being drilled is abandoned;
    - if debt remains, the bank keeps a lien on oil revenue until it is clear.
  - **The land and wells stay with the company** through a foreclosure.
  - **Correction.** As first built, this note claimed that no state was unwinnable. That was wrong: the gameplay review found that the commonest failure (a company that still owns its rig and has run out of money) had no way back, because hiring out the crew required giving up the rig. The revision below replaces that guarantee with an honest rule: the game always shows the way back when one exists, and says plainly when none does. Bankruptcy is a real outcome.
- **Saves: schema 2.** The version-1 migration turns the stored cash into "Balance brought forward" plus the rig on the books, grants an active well's land a lease, and adds empty lease, production and bank books. It is idempotent and tested against a real version-1 save. Loading validates that every entry balances and that the balances match a recompute.
- **The books in the UI.** The clock bar shows cash in hand and any debt, and opens the Company's Books:
  - the position;
  - the bank counter: borrow, repay $50 or all of it, and the recovery actions;
  - the cash book by month, summarised by heading (Land, Drilling, Crew, Oil, The bank…). Each month's entries fold away, with Date, Particulars, Paid out, Received and Balance columns.

  Daily rig-time entries are aggregated in the month summary, so the book stays readable.
- **Not yet:** the cash-flow forecast (M2) and the monthly statement as a document. The month summary in the books stands in for both until the economy (M5) gives them something to forecast.

**Revision after the PR #5 gameplay review**

The review played the build on an iPhone and ran campaign simulations over many seeded worlds. It found that an unattended rig could lose the whole campaign in a second of real time; that a failed first well usually left no way back; and that the game never said when the goal was met or the company was finished. This revision fixes those, and nothing more.

- **Idle-rig guard** (`systems/rig.ts`).
  - A rig left standing stops the clock every three game hours, with the reason. That covers drilling by hand with nobody on the line, and stuck tools that nobody fishes for. The interrupt stops Skip and pauses every speed, so an unattended rig costs at most about $1.50 before the player is asked.
  - A warning comes once a well when the cash will pay for less than three more days of rig time. It says whether the bank will still lend.
  - The driller can be engaged while the derrick is going up, and leaving the rig view hands the tools to the driller rather than leaving the rig idle.
  - The clock bar carries a rig line while a well is going: depth, who is on the line, and how many days of rig time the cash will pay for.
- **Recovery** (`company/recovery.ts`).
  - One pure function lists what the company can still do: cap an oil well, drill on land it holds, lease and drill, take contract work, or buy a used rig, each with the borrowing it needs. The end of the campaign and every piece of advice on the plate are derived from it, so the game never recommends what the company cannot do.
  - **Contract drilling** replaces crew hire-out. The company's own rig drills a month for another operator: $150 for the crew's wages and fuel up front, $400 when the job is done. The rig stays the company's. It is offered only while the company cannot afford a well of its own, so it is a way back, not a way to get rich.
  - **Balance.** Credit rose from half to three quarters of the collateral, so a broke company that owns its rig can always borrow the wages for a contract. Lease prices are unchanged: the simulations showed that cheaper leases did not change the outcome at the obvious prospect, where wells end when the money runs out.
- **Verdicts** (`ui/Outcome.tsx`).
  - Capping the first oil well is acknowledged as the campaign's goal met, once, with what it took.
  - When no path remains, the campaign ends and says why. The sheet lists the wells, what the money went on, and what was learned, and offers a new campaign. Company commands are refused from then on.
- **Saves: schema 3.** The v2 → v3 migration adds the idle and low-funds fields to wells, the contract and the campaign's outcome, and drops crew hire-out. It is idempotent.
- **Measured, before → after** (hill-flank first well with the driller, 44 worlds; recovery by following the game's own paths):

  | | Before | After |
  |---|---|---|
  | First well that ran out of money, with a way back to a second well | 0 of 38 | 37 of 37 (median 2 months: 2 contracts) |
  | Borrow to the limit first, then fail | (not modelled) | 37 of 44 bankrupt: the campaign ends and says so |
  | Skip twice after the derrick is up | well abandoned at 2 ft, $0 | about $3 of rig time, well still going |

**Guiding principle for the next phase**

BLACK GOLD should reward geological knowledge, drilling competence, calculated risk and sound business judgement. Success should never be guaranteed, but informed decisions must materially improve the player's odds. The player should become a better oilman through experience.

- **Gas** should become meaningful geological information and an operational challenge, not an automatic end to a well. Today a gas sand finishes the well; the review found that a quarter of wells drilled over the shallowest oil end at a gas cap above it.
- **Company progression** should emerge from successful exploration, production, reinvestment and expansion, not from arbitrary deadlines.
- **Open findings from the review**, deliberately not addressed in this revision:
  - prospecting is free, and surface signs are weakly predictive (M7 prices fieldwork, provisionally);
  - the hired driller never sets casing, so fishing jobs dominate the cost of a well;
  - after the first producing well, money accumulates with nothing to spend it on;
  - on phones the goal sits below the fold;
  - hand drilling is long and shallow.

**Casing and hired drillers (approved design)**

Approved for implementation after the casing and driller proposal. The two systems are designed to meet: casing is where a driller's judgement shows.

- **Casing strings.** Up to three telescoping strings per well: 10-inch, 8¼-inch and 6⅝-inch. Each runs from the surface to where it is set; the hole below continues at the smaller size. Three is a maximum, not a program: a well finished with fewer strings costs less, and that is its reward.
- **Two jobs, kept apart.**
  - *Mechanical stabilization:* any string holds up the walls above its shoe, so the sands behind it stop caving.
  - *Hydraulic isolation:* only a string landed in an impermeable bed (clay or caprock) shuts off water. A string seated in sand still steadies the hole but does not shut off water, and sand keeps working in beneath the shoe.
- **Water above the pay.** A water sand left open above the oil, behind no sealed string, makes the well come in cut with water, and it sells less.
- **Pulling casing.** Pipe can be pulled from a dry hole and part of its value recovered, at the cost of rig days. Pipe seated in sand comes back worse.
- **Driven casing through quicksand** is deferred.
- **Drillers.** Seeded candidates in Beaumont, each with hidden ability (feel, judgement, reliability) and a public reputation. A lightweight temperament (cautious, aggressive, economical or methodical) is independent of competence: a tendency, not a ranking.
  - True ability stays hidden. No numbers, stars or reveal meters: the player learns from what a driller says and does, and from his record across wells.
  - His reports and recommendations come only from what he could observe: the bailer, the hole's behaviour, the line, the pipe in the hole, the money. Never from undiscovered geology or reservoir truth. Evidence and interpretation stay distinct.
  - A declined recommendation is remembered and not raised again until circumstances change materially.
  - **Money sense is a separate trait.** He may counsel plugging a hole on economic grounds, from what he can see: what the hole has cost, the money and credit left, the depth, and what the bailer has shown. A hidden prudence, independent of feel, judgement and reliability, sets when he speaks; temperament sets how. A fine driller can be financially reckless, and an ordinary one prudent.
  - Only the player plugs a hole. Standing orders never authorize it.
  - **Standing orders.** "Ask before spending" by default. "Use your judgement" gives a budget per calendar month, counted cumulatively. Autonomous spending never draws the company below its recovery reserve; beyond the budget or the reserve, he asks.
- **The casing in the cutaway** is inspectable: each string's size, depth, cost, the seat as the bailer described it, and how it has performed. Nothing below the bit is shown.
- **Balance** is judged across cost, time, mechanical failures, water contamination, casing efficiency and successful wells, over an expanded seeded sample. PR #5's recovery margins and the 37-of-37 second-well regression must hold.
- **Provisional abstractions.** Pipe sizes, prices per foot, drillers' and crews' day wages, salvage fractions and the time to run and pull pipe are gameplay values, not verified history. They are marked so in the code and here, to be corrected as sources are found. Partly verified: the Gladys City dry holes of 1893, 1895 and 1896 on this hill, the difficult sand below about 300 ft, and cable-tool wells running up to about three telescoping strings with a drive shoe.

**Casing and hired drillers (as built)**

- **Casing** (`company/casing.ts`, `hidden/casing.ts`).
  - Up to three strings: 10-inch, 8¼-inch and 6⅝-inch.
  - Each string is priced by its length to the surface (provisional: 50¢, 35¢ and 22¢ a foot).
  - Setting pipe bails the hole first, so every seat is what the bailer saw.
  - Any string resets the open sand above its shoe. A seat in clay, caprock or salt also stops the leak beneath it; a seat in sand leaves sand working in as if 18 ft of sand stood open (provisional).
  - The first bail after a string is set shows the crew which it is: "bails dry", "water still comes in" or "sand under the shoe".
  - The hole records where it made water. At capping, each water sand above the pay that no sealed string covers cuts the oil: a third for one, about half for two or more (provisional).
  - Pulling pipe from a dead hole takes rig days and recovers 50% of a sealed string's cost or 30% of a string seated in sand (provisional). It is a recovery path when the pipe fetches more than the days.
- **Drillers** (`company/crew.ts`, `hidden/drillers.ts`).
  - Candidates are seeded per calendar month. Ability is a pure function of the seed and the driller's id: never saved, never shown, and sealed from the UI by lint.
  - The day rate is the crew's $9 plus his wage. The starting driller costs $3, so the old $12 a day is unchanged.
  - Ability shapes the feed (spread), lapses of slack line, and when he bails and dresses. Temperament shifts habits only: how far he leads the line, how soon he bails, how much open sand he stands, and how many fishing jobs he will run.
  - His record keeps outcomes only, credited to the driller in charge of each well.
- **Judgement** (`company/judgement.ts`).
  - `assess()` takes an Observations record (the bailer's calls, open sand, pipe left, water seen and shut off, stuck tools, money) and cannot see below the bit.
  - A capable judge waits for a seat that seals (patience grows with judgement) and takes a clay or rock seat sooner. A poor one runs pipe wherever he stands and says plainly that it "will hold the walls up, not the water".
  - Asking stops the clock. A declined recommendation is remembered until the hole is 100 ft deeper, has 50 ft more open sand, a new string, or a new stuck. Unanswered advice lapses after an hour of play.
  - Under "Use his judgement" he acts within a calendar-month budget, counted cumulatively, never leaving less than the recovery reserve (contract wages plus three days of rig time), and never plugs a hole without asking.
  - **Counsel to quit** (`moneyConcern()`). He speaks in two situations, both read only from the books, the depth and the bailer:
    - *Running short:* the cash in hand would buy only a few weeks of rig time, too little to start another hole. Unborrowed credit does not count, because the rig stops when cash runs out; his words name the credit separately ("and $300 more only if you borrow"). The cautious man speaks at about 30 days, the economical at 24, the methodical at 16, the aggressive at 5. Hidden prudence scales those (0.3 to 1.2 times).
    - *A long dry run:* 800 to 1,100 ft without a show (scaled by prudence; never for the aggressive man), once the hole has eaten most of the company's money.
    - A show of oil or gas within 150 ft of the bottom is reason to keep on, and he will not counsel quitting then. Sulphur water is not.
    - His words name what the hole has cost, the depth, the last show, and the money and days left. They never mention anything below the bit.
    - Declined, he does not raise it again until the hole is 300 ft deeper or the cash in hand has fallen by a third.
    - Accepting it plugs the hole at once, and the rig is free. Every value here is provisional.
- **Interface.**
  - The rig's casing gauge opens the casing sheet. The cutaway draws each string at its own diameter, and a shoe seen to leak is marked in carmine.
  - His advice is a card at the rig, and a sheet on the map with "Look at the rig first".
  - The crew sheet holds his reputation, record, notes, standing orders and the men looking for work.
- **Saves: schema 4.** The v3 → v4 migration turns old casing into one paid-for 10-inch string and adds the crew at the old day rate. It is tested against a real schema-3 save made by the production build, which also imports through the UI.
- **Balance, measured** (stage-6 harness: 40 seeded worlds, 29 with oil at their best site and 27 with a printed hill; the driller drills and his technical advice is accepted, his counsel to quit declined, so these rows measure drilling skill):

  | Best site | Oil | Wet | Stuck per 1,000 ft | Fishing per well | Strings per well | Sealed | Casing | Cost |
  |---|---|---|---|---|---|---|---|---|
  | Best candidate | 52% | 3 of 15 | 1.1 | 1.1 | 1.9 | 31% | $257 | $902 |
  | Starting driller | 38% | 6 of 11 | 1.4 | 1.4 | 2.6 | 13% | $271 | $897 |
  | Worst candidate | 34% | 7 of 10 | 2.0 | 1.9 | 2.8 | 7% | $245 | $912 |
  | Starting driller, casing advice refused | 10% | 3 of 3 | 3.9 | 2.7 | 0 | — | $0 | $667 |
  | Careful hand-driller reading the bailer | 55% | 2 of 16 | 1.3 | 1.3 | 2.0 | 36% | $306 | $939 |

  - Before this phase, with the same kind of ground, the hired driller struck oil in 31% of best sites (he never cased), and a careful player cased 14 times a well for $477.
  - At the hill flank every policy strikes about 7%: the ground decides there.
  - Trusting the driller's judgement with a $300 monthly budget reproduced accepting every recommendation exactly, without the interruptions.
  - **Recovery (PR #5's requirement):** all 38 first wells that ran out of money at the hill flank reached a second well (median one month, one contract).
  - Borrowing to the limit first, then failing: 12 of 44 companies went bankrupt. That is fewer than before this phase, because pipe left in a dead hole can be pulled and sold.
- **Counsel to quit, measured** (the same harness; each world drills one first well; "followed" accepts every recommendation, "declined" refuses only the counsel to quit; after the cash-in-hand correction below):

  | Hill flank (poor ground, 27 first wells) | Plugged on his advice | Money ran out | Cash left after a dry hole | Oil |
  |---|---|---|---|---|
  | Best candidate, followed / declined | 22 / 0 | 0 / 13 | $182 / $64 | 1 / 2 |
  | Starting driller, followed / declined | 20 / 0 | 0 / 6 | $195 / $121 | 2 / 2 |
  | Worst candidate, followed / declined | 19 / 0 | 0 / 6 | $189 / $126 | 2 / 2 |

  | Best site (good ground, 29 first wells) | Plugged on his advice | Oil | Cash left after a dry hole |
  |---|---|---|---|
  | Best candidate, followed / declined | 7 / 0 | 41% / 52% | $316 / $330 |
  | Starting driller, followed / declined | 5 / 0 | 38% / 38% | $301 / $298 |
  | Worst candidate, followed / declined | 6 / 0 | 28% / 34% | $315 / $304 |

  - On poor ground his counsel keeps capital: no first well is drilled to the last dollar, and a dry hole leaves 50% to 185% more cash.
  - On good ground it has a price: up to three holes in 29 that would have come in are plugged. Advice from observation alone cannot know which holes those are, and that is intended. Quitting is a real decision with a real cost, not a hint. His words now say how much credit is left, so a player who believes in the hole can borrow and drill on.
  - How much is left when he speaks differs by driller and temperament, because prudence is independent of skill: an aggressive, imprudent man speaks with two or three days of rig time in hand, a cautious, prudent one with a month.
  - An earlier tuning, triggered by the share of capital the hole had eaten, plugged 19 of 29 best sites and cut the best candidate's oil from 52% to 10%. It was rejected.
  - **Recovery with the counsel followed:** 40 of 40 companies whose first well failed reached a second well (median one month, one contract), and 16 of them could start it at once (7 before the correction). Borrowing to the limit first, then failing: 9 of 44 went bankrupt.
- **Investigation: "$99 vs $51 kept, but 10 vs 16 wells drilled"** (owner's question after PR #6).
  - *The reading.* The 10 and 16 were not wells drilled. Each world drills one first well; they count how many of the 27 first wells ended because the money ran out. Following his counsel, fewer ran dry (10 against 16), and those that were plugged kept cash. On that reading the two figures agree.
  - *The flaw the question exposed.* A per-world breakdown showed that in all 10 wells that still ran dry, he had never spoken. Several of those men were fairly prudent (a methodical driller at prudence 0.67, an economical one at 0.59).
  - *Cause.* He measured the money left as cash plus unborrowed credit ($300 at the start). The rig stops when cash alone cannot pay the day: credit is drawn only when the owner borrows. The $300 always looked like 25 more days, so he never judged the company short, right up to the day the well was abandoned.
  - *Correction.* He now judges by cash in hand, and names the credit separately. Neither his thresholds nor any personality changed. Pinned by a unit test (little cash and unused credit: a fairly prudent methodical man speaks).
  - *Not changed.* Imprudent and aggressive men still speak late, with two or three days in hand. That is the intended consequence of financial recklessness, and it still costs those companies.
- **Open findings from this phase.**
  - Gas still ends a well, at 9 of 29 best sites. Gas development stays deferred. Driven casing through quicksand is the next engineering feature, after the economic foundation (§8, "Historical economics").

**Historical economics (research, November 2026)**

The full notes, with every figure's source and label, are in [`docs/research/economics-1885-1905.md`](research/economics-1885-1905.md). Labels:
- **Documented:** a source states it.
- **Unverified:** recalled, not yet confirmed in a source.
- **Estimate:** derived, with the method shown.

*Limit of this research.* The primary volumes could not be read directly from the research environment. Those are USGS *Mineral Resources of the United States* 1890–1902, Hayes & Kennedy, USGS Bulletin 212 (1903), the NBER petroleum chapter (Williamson, Andreano & Menezes, 1966) and the *Handbook of Texas*. The "documented" figures come from those sources' text as quoted by search engines. Read the volumes before any figure becomes a hard number in the game.

- **What the period says, against the game:**

  | Item | Period evidence | Label | The game now | Verdict |
  |---|---|---|---|---|
  | Drilling by contract, per foot | $1.00 (1877–78), $0.60 (1886–88), $0.45 (1897–98), western Pennsylvania; $0.90–$1.00 "moderate depth", c. 1900–10 | Documented (NBER; *Britannica* 1911) | Own rig: derrick $350 plus about $160 of rig time for about 1,000 ft, so about $0.50/ft before casing | Consistent |
  | A whole well, about 1,000 ft | About $1,500–$3,000 (a 1,600-ft Bradford well cost $3,434 in the early 1880s) | Estimate, from a documented anchor | About $850–$900 with casing, rig already owned | Low, but the rig is already paid for. Gulf Coast holes probably cost more per foot than Pennsylvania (quicksand, gas). |
  | Driller and tool dresser | About $3–4 and $2.50–3 a 12-hour tour; Texas common labour about $1 a day | Unverified; Texas labour documented, undated | $12 a day: crew $9 plus driller $3 | Plausible for one tour with fuel and water; unconfirmed |
  | A standard rig, new | About $1,500–$2,500 (engine and boiler, derrick, irons, tools, cable). A Drake-era engine cost $500 in 1858. | Estimate, low confidence | Rig valued at $400; used rig $300 | **Undervalued, perhaps four to six times** |
  | Casing, per foot | 6⅝-inch about $0.40–0.60, 8¼-inch about $0.75–1.00, 10-inch about $1.00–1.40. Carload freight alone was 20¢ a foot in Kansas. | Estimate scaled by weight, low confidence. Freight documented, undated. | 22¢, 35¢, 50¢ | Possibly half the period price; no primary figure found |
  | Pulled casing | Routine; recovered value unsourced | Practice documented; value an estimate | 50% sealed, 30% in sand | Keep |
  | Royalty | One-eighth, the usual rate | Documented (Pa. 1894; Texas courts) | One-eighth | Matches |
  | Land and leases near Beaumont | Land asked at $6 an acre at Spindletop in the early 1890s; $200 for 15 acres; $1 an acre for a large tract. Lease bonus or rental 10¢–$1 an acre. | Land documented (secondary); lease terms unverified | Bonus about 40¢ an acre ($110–$340 for 280–800 acres); rental about 7¢ an acre a year | Consistent |
  | Crude, per barrel | US average: 77¢ (1890), 56¢ (1891), 51¢ (1892), 60¢ (1893), 72¢ (1894), $1.09 (1895). Corsicana 50¢ (1897–98), 98¢–$1.10 (1899–1900). Lima 15¢–72½¢. Spindletop's 1901 glut fell to a few cents. | Documented (EIA series; *Handbook of Texas*) | 60¢ at the railhead, flat | Within the range. The real price moved by a third or more from year to year. |
  | Hauling and gathering | About 20¢ a barrel pipeline gathering; wooden barrels about $1–1.50 | Unverified; barrel an estimate | 20¢ hauling | Plausible |
  | Contract income | Contractors earned $0.45–$0.60 a foot around 1890; a shallow Gulf Coast hole took 30–60 days | Documented rates; days an estimate | $400 for 30 days' work, $150 wages | Consistent, slightly generous |
  | Interest | Texas usury ceiling about 10–12% in the 1890s; high-interest lending widespread | Ceiling unverified; practice documented | 8% a year | Somewhat low |
  | Company capital | Gladys City Oil, Gas & Manufacturing Co. incorporated 1892, its capital not found. Lucas's first hole stopped at 575 ft when the money ran out. | Documented / not found | $1,500 cash and a rig | Consistent with small, fragile ventures |
  | Production | Corsicana: 22 bbl a day from one well (1896); 544,620 bbl from 342 wells (1898) | Documented | Up to 150 bbl a day a well, limited by hauling | Generous for the 1890s Gulf Coast, before Spindletop |

- **Conclusions.**
  - The game's running economy (cost per foot, wages, royalty, leases, oil price, contract work) is within the period's range. It is credible as it stands.
  - The rig is the clear outlier. It is the company's main asset, valued at $400 where the period suggests well over $1,000. That figure also sets the company's credit: 75% of the rig, $300.
  - Casing may be priced at about half the period figure, but no primary source was found. It stays as it is until one is.
  - A flat 60¢ oil price hides the period's real risk: the price swung by a third or more within a few years.

- **Recommendations, as first presented:** value the rig at about $1,500 with a 20% advance; follow the year's oil price; raise interest to 10%; hold everything else until primary sources are read. All approved by the owner, with the rig's value "subject to historical verification".

**Historical economics (approved and built, schema 5)**

- **Verification.** The research environment was given access to the primary sources, which were then read directly. The verified figures are in §0 of the research notes. Of the approved changes:
  - *Rig at $1,500: supported.* A supply house's prices printed in Whiteshot (1905) put a cable-tool outfit at about $1,130–$1,900 before timber: rig irons $50–275 (a framed rig $600–750), boiler and engine $580–900, tools and cable from $500. The NBER's 1,000-ft Appalachian well of 1886–88 cost $2,119 all in, the rig, engine and boiler at minimum prices.
  - *Oil by the year: verified* in EIA's annual series (US average first-purchase price).
  - *Interest at 10%: not verified* against an 1890 Texas source. It is kept as a credible period rate, marked provisional.
- **Rules (`company/bank.ts`, `company/production.ts`).**

  | | Before | Now | Basis |
  |---|---|---|---|
  | Rig on the books | $400 | $1,500 new; $900 if bought used | Whiteshot (1905) prices; used price an estimate |
  | What a rig fetches when sold (by the company or the bank) | the book value, at foreclosure | $750 | Estimate |
  | A used rig to buy | $300 | $900 | Estimate |
  | Bank's advance | 75% of rig and oil | 20% of the rig's book value; 75% of a well's next half-year of net oil | Approved; the oil advance is unchanged |
  | Credit at the start | $300 | $300 | Preserved |
  | Interest | 8% | 10% | Provisional |
  | Crude | 60¢ flat | the year's US average: 77¢ (1890), 56¢, 51¢, 60¢, 72¢, $1.09 (1895), … | EIA, verified |
  | Pulled casing sold | credited to equipment | credited back to drilling, where it was charged | Book-keeping correction |
- **Economic integrity: what the higher value would have broken, and how it is closed.**
  - *Foreclosure as a sale at book value.* The bank used to set the rig's full book value against the loan and pay the surplus to the company. At $1,500, borrowing $300 and defaulting on purpose would have turned the rig into about $1,200 in cash. Now the bank sells it for what a used outfit fetches, $750. The company gets $750 less what it owed, and the other $750 of book value is a loss against capital. Pinned by a test.
  - *A free rig on credit.* Credit was computed on a constant rig value. Buying a used rig for $300 would immediately have raised $300 of credit against the new $1,500 value. Now credit follows the book value of the rig actually owned: a used rig bought for $900 carries $150 of credit.
  - *Sell and buy back.* A rig sells for $750 and a replacement costs $900, so no round trip makes money. Pinned by a test.
  - *Selling while in debt.* The bank is paid first from the price, because the rig is its collateral.
  - *Foreclosure without a rig.* A company that has sold its rig and then defaults is not stripped of a rig a second time. Pinned by a test.
  - *Old saves.* The v4 → v5 migration revalues an owned rig by a ledger entry against capital: the opening rig from $400 to $1,500, a rebought used rig from $300 to $900. A sold or seized rig is not revalued. Credit is unchanged.
- **Selling the rig** is new: a consequential decision, not a source of cash. It is offered in the books only while the rig is idle (not drilling, pulling casing or on contract), and takes a second tap that states the stakes first:
  - the $750 price against the $1,500 on the books;
  - the bank paid first;
  - no drilling or contract work without a rig;
  - $900 to buy one back.

  A company that sells its last way forward is finished, as with any other bankruptcy.
- **Starting balance sheet.** $1,500 cash and a $1,500 rig, so capital is $3,000 (was $1,900). Credit is $300, as before.
- **Measured against production (main at 9242bb4):** a three-year campaign harness over the same 44 seeded worlds, with the game's own recovery paths.

  | Policy | Build | Survived 3 years | Struck oil | Median cash − debt with oil | Median cash − debt without | Debt peak, median / max | Rig lost to the bank |
  |---|---|---|---|---|---|---|---|
  | Prudent, hill flank first | production | 4 / 44 | 4 / 44 | $33,521 | −$191 | $300 / $302 | 0 |
  | | new | 4 / 44 | 4 / 44 | $39,394 | −$191 | $300 / $300 | 0 |
  | Reckless (borrows the limit, ignores the counsel to quit) | production | 4 / 44 | 4 / 44 | $33,451 | −$251 | $300 / $300 | 0 |
  | | new | 4 / 44 | 4 / 44 | $39,306 | −$251 | $300 / $300 | 0 |
  | Prudent, best site first | production | 22 / 44 | 19 / 44 | $27,713 | −$166 | $300 / $300 | 0 |
  | | new | 22 / 44 | 19 / 44 | $30,333 | −$167 | $251 / $302 | 0 |

  - *Survival, strikes, recovery and debt exposure are unchanged.* Credit is the same $300, and every failed company in these runs ran out of cash, credit and a way forward before two unpaid months could bring a foreclosure.
  - *Profitability* follows the year's price. A company that struck in 1890 sold at 77¢ (60¢ before), then through the 1891–92 slump at 56¢ and 51¢. Over three years that came to 9–18% more for a company with oil. A strike in 1891 or 1892 would earn less than before. Nothing was tuned to offset either.
  - *Recovery (PR #5's requirement):* 40 of 40 first wells that failed still reached a second well. Borrowing to the limit first, then failing: 9 of 44 bankrupt. Both are unchanged from PR #7.
- **Unintended consequences, and the ones accepted on purpose.**
  - *Losing the rig is now close to final.* After a foreclosure, a company needs $900 for another rig where it needed $300: it must have kept about $450 in hand, against about $200 before. That is historically plausible and kept. Selling equipment was a last resort, not a revolving door.
  - *The capital figure is larger,* so anything that reports net worth reads higher. The in-game sheets report cash, debt and spending, not net worth.
  - *Credit from oil* is now worth less in a low-price year, because it is valued at the year's price.
  - *Not yet modelled:* depreciation of the rig, a Gulf Coast price discount (none documented for these years), storage of oil to wait for a better year (no storage exists yet).

**Driven casing through quicksand (engineering design; approved with the owner's decisions below, and built)**

Evidence (verified; research notes §0): Isler (1902); Hayes & Kennedy, USGS Bulletin 212 (1903); Whiteshot (1905); *Mineral Resources 1889–90*; *Handbook of Texas*.
- **What history allows.**
  - Driving is a cable-tool technique, done with the rig's own bull wheel. A rope from the bull wheel lifts and drops a heavy maul or "monkey" onto a drive head screwed to the pipe, "much in the same manner as piles are driven" (Isler).
  - The bottom joint carries a steel drive shoe with a chisel edge. The pipe is turned "as long as it will move before resorting to driving". Inside the pipe the bit or sand pump clears the sand ahead of the shoe.
  - In a district whose ground is not well known, "it is much safer to use drive pipe": heavy pipe, in 10, 8, 6 and 4¼-inch sizes (Whiteshot).
- **What history says goes wrong.**
  - Friction grows with every foot driven: "perhaps not more than 80 or 100 ft. can be driven without the pipes being injured". Past that, the driller sets a smaller pipe inside, telescope-fashion (Isler).
  - Joints strip or burst under the blows, "thereby causing utter failure"; an inferior tube "means total collapse of the well" (Isler).
  - On the Gulf Coast, driving through heavy gravel "entails considerable risk, and often the loss of the well by damage to the casing" (Bulletin 212).
  - Running sand rises 30–40 ft in the hole at a touch of the tools (Isler), and filled one Sour Lake well's casing 300 ft in a few hours (Bulletin 212). A tube collapsed in quicksand at 400 ft and the well was abandoned (*Mineral Resources*).
  - The Gladys City company's three shallow cable-tool holes, from 1893, all failed (*Handbook of Texas*).
- **Proposed mechanic.** A genuine decision with real engineering limits, not a button that removes an obstacle.
  1. *Running sand in the ground (truth, hidden).* Some sand beds, chiefly the shallow Beaumont and Lissie sands, are "running". A seeded property of the bed, scaled by depth and water, sets how fast it flows into an open hole. It is never shown. It appears only as evidence:
     - the bailer's reports ("the sand comes in as fast as we bail it: 30 ft in the hour");
     - fill that returns at once;
     - tools sanded up.
  2. *Open hole fails in it.* Drilling makes little or no hole while the sand runs in. Ordinary casing lowered into the hole hangs up above the running sand and cannot be landed through it. Left open, the sand buries the tools: a stuck job, or the hole is lost.
  3. *Driving pipe* is a casing method: "Drive pipe" instead of "Run casing". It uses one of the three strings (10, 8¼ or 6⅝-inch) and costs more than ordinary casing per foot, plus a drive shoe and drive head. It is worked in rounds:
     - drive a few feet;
     - clean out inside;
     - drive again.

     The driving log shows the feet made per hundred blows. Progress is fast in running sand, slower in gravel and clay. Friction grows with the length driven and with the diameter.
  4. *Refusal.* When a round makes almost nothing, the pipe has refused. The driller can stop there and continue below with the next smaller pipe (one string fewer for the rest of the well), or pound on.
  5. *Failures,* each with a seeded, observable cause:
     - *Parted or stripped joint.* The string still stands, but sand and water come in at the break, so it acts like a shoe seated in sand. It is likelier the longer the pipe is pounded past refusal, and with a poor or hasty crew.
     - *Collapsed pipe.* The hole is lost (abandon or fish at great cost). Rare, chiefly when the pipe is pounded long past refusal in deep, heavy running sand.
     - *Sand heaving inside the pipe* when it is bailed too hard: hours lost, a stuck job possible.
     - *Pipe sand-locked:* driven pipe comes back from a dead hole far less often than run casing.
  6. *Seal.* Pipe driven through the running sand and into the clay beneath shuts it off for good: hydraulic isolation, as in the existing casing model. Pipe that refused inside the sand only steadies the walls above.
  7. *The driller (existing traits only; no new traits).*
     - Feel and judgement: how early he recognises running sand from the bailer, and when he calls refusal.
     - Reliability: how evenly he drives, which sets the joint-failure risk.
     - Temperament: the aggressive man pounds past refusal and risks the pipe; the cautious man stops early and spends a string size.

     His advice ("This sand is running: I'd drive pipe through it", "She's refused: I'd stop and go down inside with the next size") follows the existing advice rules. It comes from observation only, and declined advice is remembered.
  8. *Consequences downhole.* Every string spent on quicksand is one fewer for the water sands below. The smaller hole leaves less room to fish. Where a shoe was driven to clay or stopped in sand decides whether the pay comes in wet.
- **Data and saves.**
  - A string gains how it was set (run or driven), its driven length and any damage.
  - The hole gains its driving log.
  - Running-sand strength is a pure function of the seed in `hidden/`, never saved.
  - A schema-6 migration marks existing strings "run".
- **Stages (each with tests and green checks):**
  1. running sand in truth and its evidence;
  2. the drive operation, friction, refusal and failures;
  3. the driller's judgement and advice;
  4. the UI (driving log in the casing sheet, driven pipe and shoe in the cutaway, mobile);
  5. a balance harness on quicksand ground, by driller and policy, across cost, days, strings spent, failures, wet wells and wells lost;
  6. documentation.
- **Open questions for the owner.**
  1. *Drive-pipe price:* no primary figure was found. Proposed: about 1.6 times ordinary pipe per foot, provisional.
  2. *Drive head and shoe:* a one-time purchase (proposed: shoe per string, head bought once), or folded into the pipe price.
  3. *Collapse:* should it always lose the hole, or allow a very costly fishing attempt?
  4. *Difficulty target:* thick quicksand (over about 100 ft) should usually cost two string sizes and sometimes the hole, as the Gladys City record suggests. Is that the difficulty you want?

**Driven casing through quicksand (as built, schema 6)**

- **Owner's decisions.**
  - Drive pipe at 1.6 times ordinary casing per foot, provisional.
  - The drive head is reusable equipment, bought once; the drive shoe is a consumable on each driven string.
  - A collapsed string allows an expensive, slow swaging job with no promise. Severity, depth, equipment and the driller's hand decide whether it can work; some collapses never can; it is no cheap, repeatable escape.
  - Thick running sand may cost two casing sizes or the hole. The 80–100 ft driving limit is a practical range, not a hard boundary.
  - The player drills blind: no precise warnings, no percentages, no fixed thresholds. Good drillers reduce uncertainty; they do not remove it.
- **What is sourced and what is a gameplay assumption.**

  | | Sourced (research notes §0) | Provisional gameplay value |
  |---|---|---|
  | Running sand ("quicksand") in the Beaumont section | Bulletin 212: the drillers' word for the Beaumont sands; sand filling a casing 300 ft in hours. Isler: rising 30–40 ft at a touch; "the most serious difficulty". | Where it lies: lenses in the Lissie, Willis, Oakville and Frio beds, patchy across about 1.6 km and down about 45 ft (`hidden/quicksand.ts`). Strength 0–1. |
  | Open hole and let-down pipe in it | Isler: the bore must be tubed through it. *Mineral Resources 1889–90*: a tube collapsed in quicksand and the well was abandoned. | Inflow up to 14 ft an hour, heave up to 35 ft, and pipe hanging at the first strong sand. |
  | Driving | Isler and Whiteshot: a maul or monkey on a drive head, a steel shoe, heavy drive pipe, turning before driving, telescoping smaller pipe below. "Much safer" where the ground is unknown. | Rates (sand 3.2, gravel 1.3, clay 1.1 ft an hour before friction). Friction rising with length driven, around a practical 90 ft scaled by pipe size (±15%), the driller's feel (0.6–1.4×) and the ground. |
  | Limits and failures | Isler: "perhaps not more than 80 or 100 ft" before injury; joints strip or burst under the blows. Bulletin 212: driving through gravel "often" loses the well by damage to the casing. | Joint and collapse hazards per hour, which rise steeply past refusal. Refusal judged against the pipe's own best rate. |
  | Collapse | Collapse and the loss of wells are documented. | The swaging job: $150 and 4 days a try, at most 3 tries, odds falling 40% a try. Severity is hidden; at 0.75 or more nothing opens it. |
  | Prices | Supply-house prices for rigs and tools (Whiteshot). | Drive pipe at 1.6×, the head at $40, shoes at $4–6, salvage of driven pipe at 10%. |
- **How it plays.**
  - The bailer tells the crew in words: "Sand keeps coming back into the hole", "The sand comes back in as fast as it is bailed", "It heaved up about 20 ft as the bailer came out". It never says how much sand lies below or how strong it is.
  - The driller reads it. A good judge calls running sand at about the right point; a poor one mistakes ordinary caving for it, or misses it and lets pipe down, which hangs.
  - He recommends driving. With the drive head (bought once) he drives the next size of pipe, bought for 100 ft and settled when set: unused joints go back, and pipe driven further is paid for.
  - The driving panel shows the shoe, the feet driven, the hourly log as bars, and his word for it: "going down steadily", "harder", "hard". He calls refusal by the feel of the log, when depends on his judgement and temper. The player then sets the pipe or drives on.
  - Driving on risks a parted joint (the pipe still stands but seals nothing) or a collapse (the tools stop above it).
  - Under "use his judgement" he sets the pipe at refusal himself. Driving still counts against the month's budget and reserve, and he never abandons a hole on his own.
  - Every driven string takes one of the three sizes. Thick sand can take two, leaving less for the water sands below. A hole lost in the sand is a hole lost.
- **Measured** (driving harness: 20 seeded sites for each thickness of running sand within 900 ft of a hill, one well each; the driller drills, his advice is accepted, his counsel to quit declined):

  | Ground (thickest lens, median) | Policy | Through the sand | Strings used | Parted joints / well | Collapses (swaged) | Days |
  |---|---|---|---|---|---|---|
  | Thin (35 ft) | best / starting / worst driller | 18 / 18 / 17 of 20 | 1.5 / 2.25 / 2.25 | 0 / 0 / 0.05 | 0 | 19.5 / 20.5 / 22.5 |
  | | starting, let-down casing only | 9 | 0.85 | 0 | 0 | 42.0 |
  | | starting, pounding past refusal | 16 | 2.05 | 0.95 | 2 (0) | 18.8 |
  | Thick (75 ft) | best / starting / worst driller | 14 / 11 / 12 | 1.6 / 2.0 / 2.3 | 0.15 / 0.1 / 0 | 0 | 20.6 / 22.3 / 22.2 |
  | | starting, let-down casing only | 3 | 0.8 | 0 | 0 | 45.0 |
  | | starting, pounding past refusal | 11 | 1.85 | 0.95 | 2 (1) | 22.4 |
  | Very thick (140 ft) | best / starting / worst driller | 8 / 8 / 6 | 1.55 / 2.1 / 2.2 | 0.05 / 0 / 0 | 0 / 1 / 1 | 24.3 / 25.1 / 26.5 |
  | | starting, let-down casing only | 0 | 0.65 | 0 | 0 | 48.6 |
  | | starting, pounding past refusal | 6 | 1.9 | 0.95 | 3 (0) | 22.2 |

  - *Driving is what gets a hole through.* With let-down casing alone, thick sand is passed 3 times in 20 and very thick never. Those holes spend twice the rig days making nothing.
  - *Skill reduces uncertainty, it does not remove it.* The best driller gets through more often in thick sand, and uses about a quarter fewer casing sizes. A poor one hangs let-down pipe in running sand in about a quarter of his holes. Very thick sand still beats most holes, whoever drills.
  - *Pounding past refusal is a real gamble.* Nearly every string pounded on parts a joint; about one hole in nine collapses (7 in 60); one of those 7 collapses was swaged open.
  - *Trusting his judgement* gave the same results as accepting every recommendation, without the interruptions.
- **Campaigns against production** (three years, 44 seeded worlds, the game's own recovery paths; production = main at dfd43e9):

  | Policy | Build | Survived | Struck oil | Wells a company | Plugged or abandoned a company | Money ran out a company | Median cash − debt, with oil | Debt peak median / max |
  |---|---|---|---|---|---|---|---|---|
  | Prudent, hill flank first | production | 4 | 4 | 3.1 | 2.95 | 0 | $39,394 | $300 / $300 |
  | | new | 3 | 3 | 2.6 | 2.18 | 0.36 | $26,832 | $251 / $301 |
  | Reckless | production | 4 | 4 | 1.7 | 1.27 | 0.18 | $39,306 | $300 / $300 |
  | | new | 3 | 4 | 1.4 | 0.80 | 0.43 | $26,744 | $300 / $300 |
  | Prudent, best site first | production | 22 | 19 | 2.9 | 2.32 | 0 | $30,333 | $251 / $302 |
  | | new | 11 | 10 | 2.8 | 2.34 | 0.20 | $33,076 | $250 / $302 |

  - *The largest change in the game since the bank.* 30 of the 44 best oil sites have running sand above the pay, and 20 have a lens thicker than 50 ft. Companies that went straight to the best site survive three years half as often (11 against 22). Before this feature their holes went through the sand as if it stood.
  - That matches the record. The Gladys City company's cable-tool holes on Spindletop all failed from 1893, and the field came in only with the rotary in 1901.
  - *Kept, not tuned away,* as instructed: plausible failure stays. The lever, should the owner want quicksand rarer, is its prevalence in `hidden/quicksand.ts` (the per-formation strengths and the patch threshold), not the driving rules.
  - *Capital exposure is unchanged.* Debt peaks at the $300 the bank lends; no rig was lost to the bank. *Recovery after a failed first well is unchanged:* the PR #5 requirement test holds.
  - Profitability for the companies that strike is within the noise: 3 or 4 hill-flank strikes and 10 or 19 best-site strikes decide the medians.
- **Exploits and loopholes closed (tests in `tests/sim/driven.test.ts`).**
  - *Drive pipe bought and returned:* unused joints come back at cost and no more, so nothing is gained by buying long.
  - *Drive head:* bought once, never sold. It stays with the company when the rig is sold or seized.
  - *Swaging:* each try $150 and 4 days, the odds falling with each try, at most 3, and some collapses beyond saving. Measured over 41 collapses, a hole recovered this way cost more on average than a fresh hole to the same depth.
  - *Pulled driven pipe* fetches 10% of its cost; damaged pipe nothing.
  - *Casing sizes:* driven, hung and run strings share the three sizes, in order; no fourth.
  - *Advice after the hole ends* is withdrawn, so a pending recommendation can no longer survive the well it was about (fixed in this change).
- **Not yet modelled.**
  - Reaming ahead of drive pipe with an enlarging bit (Isler); turning pipe before driving as a separate step; heavier mauls.
  - The rotary, which is what finally beat Spindletop's sand (1901). It belongs to a later era.
  - Gas development stays deferred.

**Why companies fail: a diagnostic of the driven-casing build (analysis only; nothing rebalanced)**

The owner accepted PR #9's difficulty and asked for the causes of failure, not changes. The method:
- Three-year campaigns on the same seeded worlds as PR #9, with a scripted player.
- Every well that did not strike oil is given one primary cause, read from its record and the truth below it. Truth is used to explain, never to play.
- The companies that failed were replayed with one decision changed, to separate avoidable mistakes from geology no decision could beat.

The scripted player:
- leases the target and lets the driller drill, accepting his advice (including driving and refusal);
- after a failure, follows the game's own recovery paths, drilling the next survey offered at its centre;
- does no fieldwork, which is the main limit of this analysis (see below).

- **Causes, best site first** (32 worlds with a printed hill and oil in the surveys; the first well at truth's shallowest oil; 7 companies survived three years):

  | Primary cause | First wells of failed companies (25) | All wells of failed companies |
  |---|---|---|
  | Running sand: the hole stopped in or under it short of the pay, or let-down pipe hung | 9 | 21 |
  | Plugged on the driller's counsel to quit, with oil below | 7 | 20 |
  | Mechanical: a collapse, or abandoned after repeated fishing | 4 | 5 |
  | Casing sizes exhausted: all three used, still in running sand above the pay | 4 | 4 |
  | No oil within reach at the site (the recovery wells, drilled blind) | 0 | 29 |
  | Struck oil, yet the company failed (see "Open questions") | 1 | 1 |

  - The best sites are lost to the sand. Three in four of the first wells failed in or because of running sand: sand, sizes exhausted, collapses in it, and holes plugged while still fighting it. The later wells failed for want of oil, drilled where the recovery path pointed.
  - Failure does not follow lens thickness alone. Of the 25 failed companies, 7 had very thick sand above their pay, 5 thick, 6 thin and 7 none. Of the 7 survivors, 3 had thick, 2 thin and 2 none. Capital and luck at the first hole matter as much as the thickness.
- **Causes, hill flank first** (44 companies, the obvious guess on the printed hill; 3 survived):
  - Site selection dominates. 101 of the 112 wells that did not strike had no oil within reach of the rig at all: 36 of the 41 failed companies' first wells, and nearly all the recovery wells.
  - Running sand ended 7 wells and exhausted the casing in 2.
- **What a player's decision could have changed** (each replayed on the failed companies, and on the survivors to show its cost):

  | Decision, changed alone | Best site: failed companies saved (of 25) | Best site: survivors it would have sunk (of 7) | Hill flank: saved (of 41) / sunk (of 3) |
  |---|---|---|---|
  | Hire the dearest driller in Beaumont at the start (wage is public, ability is not) | 5 | 2 | 2 / 1 |
  | Decline the counsel to quit and drill on | 2 | 1 | 0 / 0 |
  | Borrow the bank's credit at the low-money warning | 0 | 0 | 0 / 0 |
  | Move on at the first report of running sand (plug, re-spud 0.6 km along the lease) | 0 | 1 | 0 / 1 |
  | *Bound, not a strategy:* start at the shallowest oil with no running lens over 50 ft above it (needs truth) | 1 | 1 | 0 / 0 |
- **Avoidable or not.**
  - *Mostly unavoidable by any single decision.* 18 of the 25 best-site failures were not saved by any change tested. Even perfect knowledge of the sand saved one, because the oil free of thick sand lies deeper and costs more to reach. The binding limit is the starting capital ($1,500 and $300 of credit) against the price of reaching the pay through running sand with cable tools. That is the Gladys City story, and it is by design.
  - *Somewhat avoidable, at a risk.* A dearer driller saved 5 and sank 2: skill reduces uncertainty, but his wage is paid every day of a long hole. Declining the counsel to quit saved 2 and sank 1: his money sense is sometimes too careful, sometimes right. Both are real gambles. Neither is a dominant strategy.
  - *Not avoidable by money or flight.* $300 more of credit buys about 25 days, which is not enough to finish a hole the sand is beating. Moving a short way along the lease meets the same sand, since lenses are wider than a lease, and throws away the hole already made.
  - *Avoidable through better site selection, the decision this scripted player does not make.* On the hill flank, and in every recovery well, the scripted player drills blind. A player who walks the ground, consults and inquires (fieldwork) and reads the neighbours' wells chooses sites with oil beneath them. This analysis cannot measure how much of that 101-well loss fieldwork would avoid, because its value is the player's judgement. It is the largest avoidable cause, and it is the game's central skill.
- **Limits of this analysis.**
  - Single-decision counterfactuals only. Combined strategies are not tested: fieldwork first, contract drilling to build capital before the first hole, choosing a shallower target, or stopping a hole the sand is beating and holding capital for a better-evidenced site.
  - The scripted player recovers by the game's paths and drills survey centres.
  - Samples are small: 32 and 44 worlds, and 7 and 3 survivors.
- **Open questions found, not acted on.**
  - One best-site company struck oil and still failed. The scripted player caps the well without first borrowing, where the game's own cap path would offer to borrow, so this is probably the harness, not the game. Unverified.
  - The driller's counsel to quit plugged 20 wells with oil below them in failed companies. Declining it saved only 2, so it is mostly right about the money. It is still the single most common end of a hole in the best-site campaigns, and worth watching in playtests.

**Player agency audit (PR #11; analysis only, nothing changed in the game)**

*The question:* does an experienced operator, using only what the game shows the player, do meaningfully better than an inexperienced speculator?

*Method* (`tools/analysis/agency.harness.ts`, outside CI). Matched three-year campaigns on the same 120 seeded worlds (every seed with a printed hill), compared in pairs, world by world. Uncertainty: exact sign tests on the worlds where the outcomes differ, and paired bootstrap 95% intervals.

| Profile | What it may read | How it plays |
|---|---|---|
| Blind Speculator | the printed map | The existing scripted player: hill flank first; after a failure, the game's recovery paths at a survey's centre; accepts every recommendation; caps without borrowing. |
| Informed Operator | evidence only (`knowledgeOf`), the printed map, the books | Walks every survey, then twice more around each rise; the geologist on the five likeliest; asks the settlers near the three likeliest. Reads seeps and waxy dirt as oil signs, a sour spring as caprock, seeps in the mapped marsh as marsh gas. Drills the best-evidenced rise, on the crest drawn toward its strongest sign. Otherwise plays as Blind. |
| Disciplined Operator | the same as Informed | As Informed, plus: hires a well-spoken-of driller; caps with the bank's help; declines the counsel to quit only when the settlers' wells put the pay within reach; borrows to finish then; steps out about 0.6 km toward the signs after a dry hole on a rise with oil signs. |
| Omniscient Operator | hidden truth | The Disciplined play on truth's best sites, which weigh depth to the pay against running sand above it. An upper bound, not a strategy. |

The first three never read hidden state; truth is used only afterwards, to classify why wells ended.

- **Outcomes** (120 worlds, 36 months):

  | | Blind | Informed | Disciplined | Omniscient |
  |---|---|---|---|---|
  | Survived three years | 5 (4%) | 16 (13%) | 12 (10%) | 57 (48%) |
  | First site has oil below it (truth) | 10% | 36% | 36% | 75% |
  | First well struck oil | 4% | 13% | 10% | 48% |
  | First well commercial (its oil repaid its cost) | 4% | 13% | 10% | 48% |
  | Bankrupt before production | 96% | 87% | 90% | 53% |
  | Bankrupt after finding oil | 0 | 0 | 0 | 0 |
  | Months to production (median, producers) | 0.4 | 6.2 (5 of them fieldwork) | 6.2 | 0.5 |
  | Cash spent to production (median) | $1,407 | $1,211 | $1,246 | $1,307 |
  | Cash − debt at the end (median: all / producers) | −$221 / $29,121 | −$210 / $34,722 | −$208 / $35,472 | −$135 / $32,796 |
  | Failed companies' first well, main causes | no oil at the site 108 of 115 | no oil at the site 73; casing sizes 10; plugged on counsel 9; sand 6; gas 4 | no oil at the site 72; sand 12; plugged on counsel 11; casing sizes 7; gas 5 | no oil shallow enough to choose 30; mechanical 16; sand 9; gas 4 |

- **Paired differences** (same worlds):

  | Comparison | Worlds better / worse | Survival difference (95% CI) | Sign test |
  |---|---|---|---|
  | Informed vs Blind | +14 / −3 | +9.2 pts (+3.3 to +15.0) | p = 0.013 |
  | Disciplined vs Informed | +0 / −4 | −3.3 pts (−6.7 to −0.8) | p = 0.125 |
  | Disciplined vs Blind | +10 / −3 | +5.8 pts (+0.8 to +10.8) | p = 0.092 |
  | Omniscient vs Disciplined | +46 / −1 | +37.5 pts (+28.3 to +45.8) | p < 0.001 |
- **The PR #10 findings, resolved.**
  - *The company that struck oil and failed* (world `…fccd0`) was the harness, not the game. Its first well came in on day 11 with $56.09 in hand; capping costs $80. The scripted player's cap was refused, though the game's own recovery path offered "cap, borrowing $50" against $300 of credit, and the rig shows that as a button. Replayed taking that offer, the company survives the three years. No change is needed. The Blind profile keeps the old behaviour so it stays comparable with PR #10.
  - *Combinations of decisions.* At PR #10's truth-chosen best site, playing every disciplined decision lifts survival from 28% to 45% (+24 / −3 worlds, +17.5 pts, 10.0 to 25.0, p < 0.001). Most of the gain came from declining the counsel to quit when the pay was within reach. In that comparison the operator knew the pay depth from truth. So combinations do rescue campaigns that single decisions could not, *when the operator knows how far the pay lies*.
  - *The driller's counsel to quit, judged against the truth below and the money left* (pay counted "within reach" if cash and credit cover the remaining feet at about 40 ft a day):

    | Profile | Times given | No pay below | Pay below, out of reach | Pay below, within reach |
    |---|---|---|---|---|
    | Blind | 209 | 197 | 1 | 11 (5%) |
    | Informed | 215 | 177 | 7 | 31 (14%) |
    | Omniscient (on oil) | 173 | 49 | 21 | 103 (60%) |

    His money sense is right most of the time on ordinary ground. On good ground it is wrong more often than right, and nothing the player legitimately sees tells the two apart.
- **Player agency, assessed.**
  - *Fieldwork gives actionable information: yes, strongly.*
    - Measured on truth over 120 worlds, domes showing gas seeps or waxy dirt had oil within the rig's reach 98% of the time (148 of 151). Sour springs alone: 13%. A mound alone: 15%.
    - On a seep-bearing dome, 60–70% of spots within 0.9 km of the crest have oil below.
    - The informed operator's first site held oil 3.6 times as often as the blind one's.
  - *Players can recognise and avoid inferior sites: largely.* Where the signs were found, the informed operator chose the right rise. In about a third of worlds the walks and the geologist found no seep or waxy dirt, and it fell back on a sour spring or a bare rise; those mostly failed. Signs are easily missed, and fieldwork costs no money, so walking again is free.
  - *Experience and discipline improve outcomes: experience yes, discipline not measurably, and this is the main design finding.* The decisions that matter after spudding (drill on or plug, borrow to finish, step out or move on) need some sense of how far the pay lies. The game offers almost none:
    - a settler's account of "hard rock" near a rise is rare;
    - the bailer shows nothing until the pay is near;
    - the driller's counsel to quit is, by design, blind to geology.

    With only that, no scripted rule tried beat the driller's own counsel. Each extra decision mostly spent money on worse odds: a dearer man's wage, step-outs on dry rises. With depth known (the truth-informed combination), the same decisions gained 17.5 points. A human player may do better than these rules; the gap is in information, not in the rules.
  - *Risk remains meaningful when the decisions are good: yes.* The Omniscient bound found oil shallower than about 1,640 ft (its search depth) in 90 of the worlds, and it still lost 33 of them: collapses and parted pipe 16, running sand 9, gas instead of oil 4.
  - *Some failures are unavoidable: yes.* In 21 of the 120 worlds (18%) no leasable survey has oil within 2,000 ft. In 30, none is shallower than about 1,640 ft. No play finds oil in the first group, and the second leaves only deep, costly holes. Contract drilling only delays the end.
  - *Players get enough information to understand why they failed: only partly.*
    - The hole's own evidence is shown: the bailer's calls, running sand, refusal, the money.
    - A dry hole never says whether the pay was absent or lay just below. That is inherent to drilling blind.
    - Nothing helps the player put a failed hole in context: the rise's signs, the settlers' wells and the bailer's log are never drawn together into a reading of the ground.
- **Finding oil against commercial production.** In this build the two are the same. Every first-well strike repaid its well, and no company failed after finding oil once it capped. All the risk sits before the strike. Two exceptions: a gas strike, which ends the well, and the uncapped case above.
- **Assumptions and limits.**
  - Scripted players are heuristics, not an optimal player. The disciplined rules are one reasonable set: a better rule set could narrow the gap; a human might do better.
  - "Oil within reach" means truth's first oil at or above 2,500 ft.
  - 120 worlds, one campaign per world and profile. The game's randomness is seeded, so differences between profiles are paired, but each world is a single draw.
  - Sample sizes are small for rare events: 16 and 12 informed and disciplined survivors.
  - The quit-counsel "within reach" test uses a flat 40 ft a day, a rough rate.
- **Recommendations** (for decision; none implemented):
  1. **Give a legitimate, imprecise sense of depth.** For example:
     - settlers' wells near a rise more often reaching the hard rock;
     - the geologist offering a range ("the caprock, if there is one, might lie at six to nine hundred feet");
     - the bailer's sulphur water and gas showing more clearly as the caprock nears.

     This is the one change most likely to turn the existing decisions (drill on, borrow, step out) into real skill. The truth-informed combination puts its value at up to about 17 points of survival.
  2. **Let the counsel to quit weigh the evidence the company has** (shows, the settlers' wells, signs on the rise), not only the money, and say what drilling on would cost ("about N more days at this pace"). It stays blind to hidden geology.
  3. **Give fieldwork a modest cash cost** (the party's wages), so that walking a survey again is a decision, not a free action.
  4. **A plain account after a dry hole:** what the hole proved (deepest bed reached, shows, sand, pipe used) and what it leaves unknown. Nothing hidden, but enough for the player to learn from a failure.
  5. **Campaign seeds:** decide whether a campaign should always have oil within reach in at least one leasable survey. About one world in five has none within 2,000 ft.
  6. **Later phase:** risk after discovery (declining wells, price slumps, hauling limits). Today finding oil is the whole game.

  Gas development and rotary drilling remain deferred.

**M7, Reading the Ground (approved and built, schema 7)**

*Why:* the PR #11 audit found that fieldwork pays but discipline after spudding did not, because the player had almost no legitimate sense of how deep the pay lies. M7 adds honest, imprecise depth evidence, makes negative evidence count, and lets the company's own holes inform the next one. There are no character upgrades and no probability readouts: the player gets better by reading evidence better.

*The owner's decisions:* the golden hash is replaced deliberately (below); worlds with no reachable oil stay as they are, with no guarantee and no reveal; fieldwork costs are provisional and calibrated against the survival threshold.

- **Observation, measurement and interpretation are kept apart.** Every new piece of evidence says which it is.
  - *Observation* (`provenance: "observed"`): the bailer's calls, now sometimes with "a few chips of gypsum"; and the account of a hole. Observations can be missed or false: gypsum comes up in about half the samples within 100 ft above the rock, and in about 3% elsewhere, from the clays.
  - *Measurement uncertainty:* each depth is given to within what produced it. The rock's top is known only to within its bail interval, and the geologist measures a rise roughly.
  - *Interpretation* (`provenance: "opinion"`, labelled "a reading" in the UI): the geologist's depth range and the company's reading of a spot. An accurate observation can still lead to a wrong conclusion. Examples: rock under a rise is no promise of oil; a dry rock says nothing of the flanks; a hole off the rock does not prove the geologist wrong.
- **The geologist's depth reading** (`ReadingEvidence`):
  - When consulted on a survey, he judges its most prominent rise.
  - He trusts, in order: the company's own log of a hole on the rise; then a settler's account of hard rock nearby; then his own rule of thumb from his measure of the rise ("the lower the rise, the deeper the rock").
  - The rule states its own spread and trusts his measurement, so it is sometimes wrong. Measured: his range contains the true depth to the rock 70% of the time (639 of 909 readings); 148 were deeper and 122 shallower.
  - On a low rise he says only "deeper than", which is right 67% of the time. On flat ground he declines to guess.
  - After a hole found the rock dry to the salt, he says he would not look for oil in that rock again, and that the flanks are deeper and harder.
- **The account of a hole** (`AccountEvidence`), written when a hole ends:
  - *Proved:* no oil or gas to N ft; hard rock from about X ft; salt; shows; pipe.
  - *What we make of it:* a reading. Examples: the rock was dry to the salt, so if it is one body there is no oil in it on this rise; nobody finds anything under the salt; gypsum suggests rock not far below; the rock was looked for and not met.
  - *Still unknown:* below the hole, the flanks, whether there is rock here at all.
  - The account is built from the bailer's calls and the books only (`company/account.ts`, which imports no truth). It is shown at the rig when a hole ends, and in the survey's notes.
- **The company's knowledge accumulates.** `knowledge/reading.ts` reads a spot from evidence alone: own holes on the same rise first, then the latest geologist's reading, then a settler's hard rock.
  - The driller's notebook (`operations.notebook`) holds what bears on his holes: readings and settlers' accounts, told to him as they come in, and the accounts of the company's own holes. The fieldwork and rig systems pass these as events.
  - The second hole on a rise is judged by the first. A rise whose rock was found dry is read as dead for caprock oil.
- **Counsel that weighs evidence.** The driller's money counsel now:
  - says plainly that a hole in the salt is finished;
  - does not counsel quitting in the rock, or with gypsum just above;
  - does not counsel quitting while the company's evidence puts the rock within its means (cash and credit). Otherwise it says what reaching it would cost ("about N days and $X more");
  - says when the hole is past where the rock was looked for and has not met it;
  - without evidence of depth, adds what each hundred feet more would cost at this hole's pace.

  It is still blind to hidden geology.
- **The section drawing distinguishes observed from inferred.**
  - The company's own holes are drawn from their bailer samples in a heavy solid frame: observed.
  - Settlers' wells are drawn in a dashed frame, "his account": told.
  - Correlations between logs are dashed carmine, and the geologist's range is a hatched, dashed carmine band, "the geologist's reading": inferred.
  - A key says which is which.
- **Fieldwork costs money** (`FIELD_COSTS`, *provisional*):
  - a man and a horse walking a survey, 50¢ a day;
  - a settler's time, 50¢;
  - Beaumont gossip, 25¢;
  - a geologist's fee and fare, $10.

  The cost is paid as the party sets out, under a new **Fieldwork** heading in the books. Without the money, the party stays home.
  - *Calibration:* at the first provisional values ($2 a day and $50 a geologist), the scripted informed operator spent $442 a company on its exhaustive programme, and its survival fell from 17% to 2%. At a quarter of those, it kept exactly 80% of its free-fieldwork survival (32 of 40 worlds).
  - The values chosen are a little under that. They are low for the period. A historical check may well raise them, and a higher cost would make an exhaustive survey programme a losing strategy for this scripted operator.
  - **They are provisionally calibrated for gameplay, pending a future holistic review of the historical economy.** They were not changed in the refinement below.
- **Schema 7** (`v6ToV7`): the driller's notebook is started from the settlers' accounts already held. Each ended hole gets its account, written from its samples. Old geologist opinions carry no depth reading; a new consultation gives one.
- **Golden hash, replaced on purpose.** The determinism run now plays the company as well as the stress system: fieldwork paid for, a settler's account, a geologist's reading, a hole drilled with the driller and abandoned, and the geologist again on the company's own log. The new world also carries the notebook. The new hash is `1a1dfac96d01af` (it was `06ce6a7704aa28` before the refinement below added the rainbow of oil). The baseline before M7, for main at 65a7053, was `1e3c8857be2e29` (a stress-only run).

*Measured* (`tools/analysis/m7.harness.ts` and `m7-compare.mjs`, outside CI). The same 240 seeded worlds were played on the build before M7 (65a7053) and on M7, three years each, with the PR #11 profiles.
- The Disciplined Operator on M7 also reads the new evidence, from the fields the field notes show:
  - it ranks rises by signs and expected depth;
  - it skips ground its evidence has ruled out;
  - it declines counsel to quit only when its reading puts the rock within its means;
  - it steps out onto the flank after a rock found dry, or back to the crest after missing the rock;
  - it stops drilling when nothing worth a hole is left.
- It never reads truth. Truth is read only to score outcomes and by the Omniscient bound. Paired sign tests and bootstrap intervals are used throughout.

| | Blind before → after | Informed before → after | Disciplined before → after | Omniscient before → after |
|---|---|---|---|---|
| Solvent at three years | 3% → 3% | 12% → 13% | 12% → 20% | 52% → 52% |
| Producing | 3% → 3% | 12% → 13% | 12% → 18% | 52% → 51% |
| Capital at the end, mean | $605 → $724 | $3,476 → $3,888 | $3,418 → $5,404 | $16,615 → $16,614 |
| Footage a company, of which on ground with no oil within reach | 732 / 659 → 732 / 659 ft | 992 / 712 → 956 / 676 ft | 913 / 620 → 823 / 566 ft | 921 / 173 → 918 / 170 ft |
| Footage drilled in salt, a company | 20 → 2 ft | 40 → 2 ft | 33 → 4 ft | 5 → 0 ft |
| Holes abandoned with oil within 400 ft below | 19 → 18 | 31 → 26 | 31 → 16 | 24 → 26 |
| Spend (drilling and fieldwork) per discovery | $53,278 → $45,886 | $13,579 → $11,636 | $13,505 → $7,312 | $2,430 → $2,424 |

- **Paired comparisons.**

  | Comparison | Before M7 | With M7 |
  |---|---|---|
  | Disciplined vs Informed, solvent | +5 / −6 worlds, −0.4 pts | +19 / −3, **+6.7 pts** (4.2 to 10.4), p = 0.001 |
  | Disciplined vs Informed, producing | −0.4 pts | +13 / −3, **+4.2 pts** (2.1 to 7.5), p = 0.021 |
  | Informed vs Blind, solvent | +9.6 pts, p < 0.001 | +10.4 pts, p < 0.001 |
  | Blind, M7 vs before | | +1 / −0 worlds, +0.4 pts |
  | Omniscient, M7 vs before | | +1 / −2 worlds, −0.4 pts |
  | Disciplined, M7 vs before (producing) | | +16 / −2, +5.8 pts, p = 0.001 |
- **Acceptance criteria.**
  - Met:
    - discipline now pays, +6.7 pts (at least 5, p < 0.05);
    - informed still beats blind;
    - blind and the omniscient bound are unchanged within noise;
    - the unwinnable worlds are unchanged (no truth changed);
    - the geologist's range is 70% right (target 60–80%);
    - informed survival is at 80% of its free-fieldwork level (target at least 80%);
    - all tests pass, and saves from schema 6 load.
  - *First pass, superseded by the refinement below:* **not met: counsel on good ground without evidence.** The target was for the driller to urge quitting where oil lay within reach much less often than 60%, below 35%. On the Omniscient bound's holes it is still 61% (150 of 246; 57% before). That bound does no fieldwork, so its driller has no depth evidence. Gypsum and the rule against quitting in the rock help only over caprock, and most of its pay is in flank sands. Where the company holds evidence, the counsel is wrong less often: Disciplined 13% of counsels (15% before), Informed 11% (12%). On ordinary ground it is no worse: 80–91% of counsels had no oil below, against 83–92% before. Nothing was tuned to close the gap. Doing so would need a flank-sand precursor in the bailer, a new observation of the ground, which is a decision for a later pass.
- **Unexpected results and tradeoffs, reported, not masked.**
  - *Solvent is not producing.* The Disciplined Operator stops drilling by choice in 17 of 240 worlds (7%). Its solvency (20%) runs ahead of its production (18%) because a company that stops keeps some capital. Production is reported beside solvency for that reason.
  - *Capital is preserved unevenly.* Mean capital rises (+$1,516 over Informed, p = 0.04), but in 125 worlds the Disciplined company ended a little poorer than the Informed one and in 94 richer: the gain is concentrated in the extra discoveries.
    - The median company without oil still ends about $240 in debt. Negative evidence stops waste (salt footage down 88%, holes abandoned short of reachable oil halved), but it does not yet turn a failing company into a solvent one.
    - Withdrawing is rarely the best play in this economy: a producing well is worth about $30,000, so even a 15% chance justifies a $900 hole.
  - *The first rule tried was wrong.* A disciplined rule that skipped any site it could not afford outright refused the game's recovery path (contract work): it stopped drilling in 55% of worlds and found less oil. It was replaced by skipping only ground the evidence has ruled out. The rejected rule's numbers are in the analysis notes; it was a harness error, not a game result.
  - *The informed operator gains little from M7* (+1.3 pts): the new counsel helps it, the fieldwork cost takes about as much away.
- **Limits.**
  - Scripted heuristics, not an optimal player.
  - One campaign per world and profile.
  - 240 worlds: survivor counts of 32 to 48 per profile.
  - The quit-counsel "within reach" test uses a flat 40 ft a day.
  - The geologist's rule of thumb is a game abstraction: no 1890 geologist knew salt-dome structure.
  - Settlers' wells were not made deeper near rises, to leave the ground unchanged. Their depth evidence is still rare.
  - Gas development and rotary drilling remain deferred. M8 (The Field) is next and not yet authorised.

**M7 refinement: the rainbow of oil, and counsel by its grounds**

*Why:* the first pass missed one criterion. On good ground, the driller urged quitting wrongly in 61% of his counsels. The cause was not a missing sign near the pay. Of those 150 wrong counsels, 89 came more than 250 ft above the oil, and only about 19 within 150 ft; no honest bailer sign reaches that far. The cause was that, having seen nothing either way, he recommended quitting all the same: a lack of positive evidence was treated as negative evidence.

- **A rainbow of oil on the bailer water** (`sheen`, observation):
  - Oil leaks a little way up from an oil-bearing bed into the waters above it, so the film comes more often as the bit nears oil.
  - It reaches about 150 ft, and applies to flank sands and caprock alike.
  - Lignite and old wood in the clays leave a stray film now and then, so it is no proof.
  - The bed is never named; the sign is in the sample's call and in the hole's account.
  - Measured: it appears in 47% of samples within 150 ft above oil, and in 2% elsewhere.
- **Counsel by its grounds.** The driller's money counsel now rests on one of three things, and says which:
  - *Negative evidence* (`quit`): in the salt; past where the rock was looked for and not met; the rock expected beyond the company's means. He recommends stopping, and says what he saw.
  - *Positive evidence* (no counsel to stop): a show of oil or gas, the rainbow, gypsum just above, in the rock, or the rock expected ahead within means.
  - *No evidence either way* (`decide`, new): he makes no recommendation. He says it is no proof there is nothing below, gives the cost of each hundred feet more and the money left, and leaves the choice to the owner. The advice card says "He makes no recommendation" and draws neither button as his.
  - *Money* (`quit`): when cash and credit cannot pay for another hundred feet, that is a fact, not a reading, and he recommends stopping.
- **Measured** (the same 240 worlds, paired with the build before M7). The scripted Blind and Informed players treat an open decision as he used to treat a quit (they plug), so their play is unchanged. Changes in the rates below come from what the counsel says, not from fewer warnings.

  | | Blind | Informed | Disciplined | Omniscient |
  |---|---|---|---|---|
  | **False-quit rate** (recommendations to quit with oil below and within reach), before M7 → first pass → refined | 6% → 7% → **0%** (0 of 25) | 12% → 11% → **3%** (3 of 90) | 15% → 13% → **10%** (15 of 152) | 57% → 61% → **0%** (0 of 7) |
  | Recommendations to quit with no oil below | **96%** | **89%** | **85%** | 43% |
  | Open decisions (no recommendation), and the share with oil within reach | 235, 8% | 60, 18% | 51, 20% | 210, 63% |
  | All counsel about the money with oil within reach | 7% | 9% | 12% | 61% |
  | Advisory coverage: dry holes with no oil below that drew counsel | 42% | 29% | 47% | 36% |
  | Solvent / producing at three years | 3% / 3% | 14% / 14% | 20% / 18% | 52% / 52% |
  | Spend per discovery | $45,959 | $11,223 | $7,324 | $2,400 |

  - **The gains are kept.** Disciplined vs Informed: +6.7 pts solvent (+18 / −2 worlds, p < 0.001), +3.8 pts producing (p = 0.035). Informed vs Blind: +10.8 pts. Blind and Omniscient are unchanged against the build before M7 (+0.4 and 0.0 pts).
  - **Read the false-quit rate honestly.** It meets the target (below 35%) because, on ground where he has seen nothing, the driller no longer recommends quitting: on the Omniscient bound's holes, 210 of its 217 money counsels are now open decisions. Oil was within reach below 63% of those. He does not know, and now says so. Where he does recommend quitting, he is now nearly always right on ordinary ground (85–96% with no oil below).
  - *Advisory coverage* was not measured before this refinement, so there is no baseline. About a third to a half of dry holes on barren ground drew counsel before they ended; the rest ended by other means (fishing jobs, the money running out, or the player's own choice).
- **Golden hash** re-pinned again on purpose: `1a1dfac96d01af`. The rainbow draws from its own random stream as each sample is taken.

## 9. Open decisions

Decisions taken so far are marked. Where a decision is still open, its default is noted and work proceeds on the default unless you say otherwise.

1. **Platform:** web-first with per-PR live preview links. *Default: yes.*
2. **Hosting:** Vercel static deploy with preview URLs per PR. This needs the repository connected to a Vercel project, which is your approval to give. *Default: Vercel, set up at M0.*
3. **Visual direction:** *Decided: B · Geologist's Plate*, chosen from three rendered directions in review round 1. See [`docs/ART-DIRECTION.md`](ART-DIRECTION.md).
4. **Units:** period oilfield units displayed by default with an SI toggle. *Default: yes.*
5. **Historical naming:** real places, fictional people and companies. *Default: yes.*
6. **Contract drilling:** *Decided:* a financial recovery mechanism for now. It is offered only while the company cannot afford a well of its own. Making it a legitimate, balanced business strategy is future work, and needs its own balance pass.
7. **Bankruptcy:** *Decided:* a legitimate failure condition. The game shows the way back when one exists and ends the campaign plainly when none does; it never guarantees recovery.
8. **First oil:** *Decided:* the first producing well marks the beginning of company growth, not final victory. It stays the current milestone; later phases build the company's growth on top of it.
9. **Next priority:** *Decided:* casing mechanics and hired-driller intelligence. Approved with the refinements recorded under "Casing and hired drillers (approved design)" in §8.
10. **Historical economics:** *Decided:* rig at $1,500 (verified against period supply-house prices), a 20% advance on it, 10% interest, and the year's documented crude price. Book value, resale value and replacement price are kept apart so the rig is never a cheap source of cash. Casing, wages and other figures wait for better evidence.
11. **Driven casing through quicksand:** *Decided and built* (§8): drive pipe at 1.6×, a reusable drive head and a shoe per string, costly swaging with no promise, and thick sand that may cost two sizes or the hole. Gas development remains deferred.
12. **Reading the Ground (M7):** *Decided and built* (§8):
    - The golden hash is replaced deliberately: `1a1dfac96d01af`, with `1e3c8857be2e29` recorded as the baseline for 65a7053.
    - Worlds without reachable oil stay, with no guarantee and no reveal.
    - Fieldwork costs are provisional and calibrated to the survival threshold.
    - Refined (§8): the rainbow of oil on the bailer water; counsel by its grounds (negative evidence, money, or no evidence and no recommendation). The false-quit target is met.
    - Open: a holistic historical review of the economy, fieldwork prices included (provisional, calibrated for gameplay).
13. **Next milestone:** M8, The Field (shared reservoirs, offset drilling, the rule of capture, a first Rush), intended but not yet authorised.
