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
  - prospecting is free, and surface signs are weakly predictive;
  - the hired driller never sets casing, so fishing jobs dominate the cost of a well;
  - after the first producing well, money accumulates with nothing to spend it on;
  - on phones the goal sits below the fold;
  - hand drilling is long and shallow.

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
9. **Next priority:** *Decided:* casing mechanics and hired-driller intelligence, proposed for review before implementation.
