/**
 * The account of an ended hole, and what a hole has cost: built from the company's books and
 * the bailer's calls only. Imports no truth (save migrations use it too).
 */
import type { AccountEvidence, SampleEvidence } from "../knowledge/types";
import { readSpot } from "../knowledge/reading";
import { accruedCents, type OperationsState, type Well } from "../operations";

/** What this hole has cost: every payment the books charge to it, and today's rig time not yet entered. */
export function wellSpent(st: OperationsState, w: Well): number {
  let cents = 0;
  for (const e of st.ledger.entries) {
    if (e.ref?.wellId !== w.id) continue;
    for (const l of e.lines) if (l.account === "cash" && l.cents < 0) cents -= l.cents;
  }
  return cents + accruedCents(st);
}

const ftw = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * The account of an ended hole: what it proved, what the company may make of it, and what it
 * leaves unknown. Built from the bailer's calls (each known only to its bail interval), the pipe
 * and the money: nothing from below the bit.
 */
export function accountOf(st: OperationsState, w: Well, result: AccountEvidence["result"]): Omit<AccountEvidence, "id" | "t"> {
  const own = st.samples.filter((s) => s.wellId === w.id);
  const mid = (s: SampleEvidence) => ({ ft: Math.round((s.topFt + s.baseFt) / 2), within: Math.max(1, Math.round((s.baseFt - s.topFt) / 2)) });
  const firstRock = own.find((s) => s.lith === "rock");
  const firstSalt = own.find((s) => s.lith === "salt");
  const rock = firstRock ? { topFt: mid(firstRock).ft, withinFt: mid(firstRock).within } : null;
  const saltFt = firstSalt ? mid(firstSalt).ft : null;
  const shows: AccountEvidence["shows"] = [];
  for (const s of own) if (s.show && !shows.some((x) => x.kind === s.show)) shows.push({ kind: s.show, ft: s.baseFt });
  const rockDry = !!rock && saltFt !== null && !own.some((s) => (s.show === "oil" || s.show === "gas") && s.baseFt >= rock.topFt);
  // The gypsum call nearest the rock (or the bottom): a stray chip far up the hole says little.
  const gyp = [...own].reverse().find((s) => s.gypsum && (!rock || s.baseFt <= rock.topFt + rock.withinFt));
  const deepest = Math.round(w.depthFt);
  const proved: string[] = [], suggests: string[] = [], unknown: string[] = [];
  if (result === "dry") proved.push(`No oil or gas came into the hole from the surface to ${ftw(deepest)} ft.`);
  else proved.push(`${result === "oil" ? "Oil" : "Gas"} at ${ftw(deepest)} ft.`);
  if (rock) proved.push(`Hard rock from about ${ftw(rock.topFt)} ft (to within ${rock.withinFt} ft: the bailer's interval).`);
  if (saltFt !== null) proved.push(`Rock salt at about ${ftw(saltFt)} ft.`);
  const showWords = { gas: "gas", oil: "oil", sulphur: "sulphur water" } as const;
  if (shows.length) proved.push(`Shows: ${shows.map((x) => `${showWords[x.kind]} at ${ftw(x.ft)} ft`).join("; ")}.`);
  if (w.strings.length) proved.push(`${w.strings.length} string${w.strings.length > 1 ? "s" : ""} of pipe; the deepest shoe at ${ftw(w.casedFt)} ft.`);
  if (rockDry) suggests.push(`The rock was dry from its top to the salt. If the rock under this rise is one body, as such rock usually is, there is no oil in it anywhere on the rise. That is a reading, not a proof.`);
  if (saltFt !== null) suggests.push("Nobody has found anything under the salt in this country: a hole in the salt is finished.");
  if (!rock && gyp) suggests.push(`Chips of gypsum from about ${ftw(gyp.baseFt)} ft: rock may lie not far below ${ftw(deepest)} ft, or the chips were the clay's own.`);
  const expect = readSpot(st.notebook, w.x, w.y).expect;
  if (!rock && expect && expect.rockFt[1] !== null && deepest > expect.rockFt[1]) suggests.push(`The rock was looked for at ${ftw(expect.rockFt[0])} to ${ftw(expect.rockFt[1])} ft (${expect.basis}) and not met: that reading was wrong, or this spot is off the rock.`);
  if (result === "gas") unknown.push("Whether oil lies below the gas.");
  else if (saltFt === null) unknown.push(`What lies below ${ftw(deepest)} ft.`);
  if (!rock) unknown.push("Whether there is rock under this spot at all.");
  unknown.push(rockDry ? "Whether the flanks of the rise, off the rock, hold oil in their sands." : "Whether the rest of the rise holds oil: its crest, its flanks.");
  return { kind: "account", provenance: "observed", wellId: w.id, name: w.name, surveyId: w.surveyId, x: w.x, y: w.y, result, deepestFt: deepest, rock, rockDry, saltFt, shows, gypsumFt: gyp ? gyp.baseFt : null, costCents: wellSpent(st, w), proved, suggests, unknown };
}

