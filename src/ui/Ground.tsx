import type { Snapshot } from "../app/runtime";
import { SURVEYS, insidePoly } from "../content/geography/surveys";
import { readSpot, type AccountEvidence } from "../sim";

const ft = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * Where the company would look on a survey: its most prominent known rise (printed, or seen by the
 * party), else the middle of the survey. Public information only.
 */
export function riseOf(snap: Snapshot, surveyId: string): { x: number; y: number; named: string } {
  const s = SURVEYS.find((x) => x.id === surveyId)!;
  const hill = snap.print.hills.filter((h) => insidePoly(s.poly, h.x, h.y)).sort((a, b) => b.reliefFt - a.reliefFt)[0];
  if (hill) return { x: hill.x, y: hill.y, named: hill.name };
  const mound = snap.knowledge.evidence.filter((e) => e.kind === "surfaceSign" && e.sign === "mound" && e.surveyId === surveyId).sort((a, b) => ((b as { reliefFt?: number }).reliefFt ?? 0) - ((a as { reliefFt?: number }).reliefFt ?? 0))[0];
  if (mound && mound.kind === "surfaceSign") return { x: mound.x, y: mound.y, named: "the rise" };
  const xs = s.poly.map((p) => p[0]), ys = s.poly.map((p) => p[1]);
  return { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length, named: "the survey" };
}

/**
 * What the company makes of a survey's ground: an interpretation, labelled as one, naming the
 * evidence it rests on. Blank when the company has nothing that bears on depth here.
 */
export function GroundReading({ snap, surveyId }: { snap: Snapshot; surveyId: string }) {
  const at = riseOf(snap, surveyId);
  const r = readSpot(snap.knowledge.evidence, at.x, at.y);
  if (!r.expect && !r.rockDry) return null;
  const e = r.expect;
  return (
    <div class="reading" data-testid="reading">
      <h3>What the company makes of it <small>a reading, not a fact</small></h3>
      {e && (
        <p>
          Under {at.named}, the rock is looked for <b>{e.rockFt[1] === null ? `deeper than ${ft(e.rockFt[0])} ft` : `at ${ft(e.rockFt[0])} to ${ft(e.rockFt[1])} ft`}</b>.{" "}
          {e.source === "geologist" ? "On the geologist's reading of the rise: a guess from the lie of the land." : e.source === "settler" ? `Because ${e.basis}: a settler's memory, not a log.` : `Because ${e.basis}: our own log.`}
        </p>
      )}
      {r.rockDry && <p class="red">No oil in the rock here, by our reading: {r.rockDry}.</p>}
      <p class="empty">Rock is no promise of oil. Where oil is found in this country, it is in that rock or in the sands against its flanks.</p>
    </div>
  );
}

/** What a hole proved, what the company may make of it, and what it leaves unknown. */
export function HoleAccount({ account, open = false }: { account: AccountEvidence; open?: boolean }) {
  return (
    <details class="account" data-testid="account" open={open}>
      <summary>What the {account.name} proved</summary>
      <h4>Proved, by the bailer</h4>
      <ul>{account.proved.map((p, i) => <li key={i}>{p}</li>)}</ul>
      {account.suggests.length > 0 && (
        <>
          <h4>What we make of it <small>a reading</small></h4>
          <ul class="suggests">{account.suggests.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </>
      )}
      <h4>Still unknown</h4>
      <ul>{account.unknown.map((p, i) => <li key={i}>{p}</li>)}</ul>
      <p class="account-cost">The hole cost ${ft(account.costCents / 100)}.</p>
    </details>
  );
}

/** The account of a given well, if the company has written one. */
export const accountFor = (snap: Snapshot, wellId: string): AccountEvidence | undefined =>
  snap.knowledge.evidence.find((e): e is AccountEvidence => e.kind === "account" && e.wellId === wellId);
