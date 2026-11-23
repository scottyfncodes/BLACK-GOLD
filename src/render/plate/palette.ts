/**
 * The plate's inks and washes for canvas drawing. Mirrors the tokens in src/ui/styles.css
 * (tests/render/palette.test.ts keeps them identical). docs/ART-DIRECTION.md holds the rules.
 */
export const INK = {
  paper: "#f3ead5",
  paperDeep: "#ebdfc4",
  rule: "#cdb896",
  ink: "#2a2118",
  inkSoft: "#6a5a48",
  carmine: "#a3302a",
  water: "#355f7a",
  relief: "#9a5b2e",
  survey: "#7b4b33",
} as const;

export const WASH = {
  prairie: "rgba(214, 178, 108, 0.12)",
  wood: "rgba(104, 122, 70, 0.17)",
  marsh: "rgba(92, 140, 142, 0.15)",
  water: "rgba(80, 130, 160, 0.42)",
  town: "rgba(196, 92, 82, 0.42)",
} as const;

/** Lithology tints, always drawn under their pattern. */
export const LITH = {
  sand: "#d6aa52",
  clay: "#788c80",
  gravel: "#c9a25e",
  rock: "#b9a37a",
  salt: "#e3c6c0",
} as const;

export const FONT = '"Bodoni Moda", Didot, "Bodoni 72", Georgia, serif';

/** Line weights (CSS px) and the minimum label size on a phone (docs/ART-DIRECTION.md §3). */
export const MIN_LABEL_PX = 11;
