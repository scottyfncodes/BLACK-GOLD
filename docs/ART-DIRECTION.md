# BLACK GOLD: Art Direction

**Chosen direction: B · Geologist's Plate.** Chosen in review round 1 over A (Survey Sheet) and C (Field Office, by Lamplight).

> The game looks like a hand-coloured plate from a state geological survey report. The ground comes first: sections are figures, not afterthoughts, and the map is Fig. 1 of an argument about what lies beneath.

**Sources:**
- the plates of 1890s–1900s state and federal geological survey reports (lithographed, hand-coloured, with figure numbers and captions);
- the standard lithology patterns;
- 19th-century conventions for drawing uncertain geology.

Tokens live in code at `src/ui/styles.css` (`:root`). This document holds the rules. Where the two disagree, fix whichever is wrong in the same PR.

---

## 1. Rules that hold in every era

### Print and manuscript
- **Print** is published geography that anyone could buy: water, woodland, marsh, prairie, relief, roads, rail, towns and surveys.
- **Manuscript** is the company's own hand: evidence marks, notes, section lines, correlations and conjectures. It is always drawn in **carmine** (`--accent`).
- **Hidden geological truth is never drawn.** Renderers receive geography and `sim/knowledge` only. Section 6 lists the tests that enforce this.

### Certainty is drawn the way geologists drew it

| Line | Meaning |
|---|---|
| Solid | Observed: seen at the surface, or logged in a well |
| Dashed | Inferred: correlated between control points |
| Dotted | Conjecture: the player's own interpretation |
| Dashed line ending in `?` | Queried: doubtful beyond this point |
| Blank paper | Not known. Never filled, tinted or patterned |

### Rock is pattern first, colour second
Every lithology is drawn with its standard pattern **and** a wash tint, so a section stays readable without colour (colour-blind safe, and safe in print).

| Rock | Pattern | Tint token |
|---|---|---|
| Sand | dots | `--lith-sand` |
| Clay, shale | short dashes | `--lith-clay` |
| Limestone | brick | `--lith-limestone` |
| Salt | crosses | `--lith-salt` |
| Caprock (anhydrite, gypsum) | inverted-V hatch | `--lith-caprock` |

### Washes
- Watercolour washes carry **landcover and geology only**: prairie, woodland, marsh, water, settled blocks, and strata in sections.
- **Infrastructure is ink, never wash.** Wells, derricks, tanks, pipelines, rail and roads are linework. This keeps the plate legible as the field fills up, which was the main risk raised against B in review.
- A wash is built from at most three translucent passes with noisy edges and a pooled darker rim. Washes never stack more than two different hues in one place.

### Restraint
- Paper, ink and one accent. The wash colours are muted and earth-derived: ochre, sap green, slate and Prussian blue. Nothing glows, and there are no gradients other than relief shading.
- The land is honestly flat: Jefferson County rises less than 30 ft across the sheet. Relief is drawn faithfully, so a 14 ft mound is the drama. Variety comes from water, woodland, marsh, surveys and settlement.
- All procedural detail is seeded from the world seed plus the feature's ID, in a `render:` namespace kept separate from geology. The same world always looks identical.

---

## 2. Composition: the plate scales with the company

B's section-first layout fits one prospect. An empire needs the map first. The composition therefore follows the player's scale:

| Scale | Lead figure | Supporting figure |
|---|---|---|
| **Prospect** (a tract, a well) | Fig. 2, the section, given generous space | Fig. 1, the map, with the section line drawn on it |
| **Field** (many leases and wells) | Fig. 1, the map | Section on demand, by drawing a section line |
| **Region and empire** | Fig. 1 at county scale, with lease plats | Index tables (wells, production) in the plate's margin, in the same type |

Every view is a **plate**, with these standard parts:
- a plate number ("PLATE III");
- a title in Bodoni capitals;
- an italic subtitle;
- figure numbers and italic captions ("FIG. 2. Section along A—A′…").

Captions say what the figure shows and what it is based on.

---

## 3. Type

- **Bodoni Moda** for everything (OFL, self-hosted woff2, about 46 KB for three styles).
- **Scale (px):** 11 · 13 · 14.5 · 16 · 19 · 25 · 34.
  - Body text is 14.5–16.
  - Captions are 13, italic.
  - Plate titles are 25–34, in capitals with `letter-spacing: 0.06em`.
  - Labels on the map are 9.5–14.
- **Minimum 11 px on a phone.** Didone hairlines thin out below that.
- **Italic for:**
  - water names;
  - captions;
  - sources and dates of evidence;
  - manuscript notes.
- **Roman capitals with tracking for:** places, relief and plate titles.
- **Evidence lists are numbered in lower-case roman numerals** (i., ii., iii.) in carmine. The order is information: it is the order of discovery.
- Numbers in ledgers and tables use `tabular-nums`.

---

## 4. Interface

- **The interface belongs to the plate.**
  - Square corners (`--radius: 0`).
  - Hairline rules between groups.
  - No cards with shadows, no pills, no gradients.
- **Buttons:** outlined in ink. Exactly one primary action per view is filled carmine.
- **Time and money sit together in one ink-dark bar**:
  - on phones, a bottom thumb bar;
  - on desktop, the foot of the left column.

  This bar is the one dark element on the page.
- **Touch targets are at least 44 px. Phones use bottom sheets.** No information is hover-only: long-press gives the surveyor's reading.
- **Canvas text is invisible to assistive tech.** The selected feature and its notes are always mirrored in HTML.

---

## 5. Evolution across eras

The plate format stays. Its printing technology and the report it belongs to advance:

| Era | The plate | The subsurface |
|---|---|---|
| I · 1890–1920 | Hand-coloured lithograph, engraved linework, Bodoni | Drillers' logs, sample columns, pencilled correlations |
| II · 1920–1960 | Four-colour printed report plates with contour lines and lease plats | Structure-contour maps, electric-log wiggle traces, early seismic records |
| III · 1960–1990 | Offset-printed figures, pen-plotter overlays on vellum | Directional survey plots, plan view and vertical section as paired figures |
| IV · 1990–2035 | Digital figures that keep the plate's hierarchy, captions and restraint | 3D wellbores, MWD and LWD curves, seismic volumes, as numbered figures |
| V–VI · 2035+ | Engineered instrument plates: etched and machined, heavy, never neon | The same certainty grammar applied to planetary sections |

The surface map is reissued as **editions** ("Revised 1903") when the world changes. Players can scrub back through editions.

---

## 6. Acceptance

Every milestone that touches the screen meets these before its PR is ready:

- **Truth invariance:** the same knowledge rendered over two different hidden geologies gives pixel-identical frames.
- **Golden frames** for every main view at iPhone 13, iPhone 17 and desktop, visually diffed in CI.
- **Legibility:**
  - nothing under 11 px on a phone;
  - zero label collisions;
  - WCAG AA contrast for interface text;
  - every meaning carried by pattern or shape as well as colour.
- **Performance:**
  - pan and zoom at 60 fps on a throttled phone profile;
  - each map tile rebuilt within 120 ms;
  - map tiles capped at 2× DPR;
  - fonts kept to their own budget (100 KB), separate from the 150 KB JS budget.
- **PIXELCRAFT** audits show no regressions. **PLAYCRAFT** applies from M3.
- **Period review:** no anachronisms in objects, words, typography or technology for the current era.

---

## 7. Ruled out

- Directions A (Survey Sheet) and C (Field Office, by Lamplight) as the main look.
  - C's cyanotype may return as a **diegetic object** in Era II: rig blueprints inside the plate world, never as the interface.
  - A's engraved water-lining and hachures remain available as linework techniques inside plates.
- Dark UI themes. The plate is a paper world. Night is a warm lamplit grade on the paper, not a dark mode.
- Generic management-game chrome: dashboards of big-number tiles, card grids, pill buttons, glassy panels, glow, gradients, neon, emoji icons.
- Washes on infrastructure, or stacked saturated washes.
- Invented relief: hills or mountains the real geography does not have.
- Anything drawn from geological truth, including "hints" that correlate with hidden structure.
