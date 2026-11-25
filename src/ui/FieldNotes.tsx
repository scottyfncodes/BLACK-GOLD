import type { GameRuntime, Snapshot } from "../app/runtime";
import { formatDate } from "../app/runtime";
import { SURVEYS, insidePoly } from "../content/geography/surveys";
import { activeLease, askingTerms, CONSULT_DAYS, COSTS, INQUIRE_DAYS, WALK_DAYS, type Evidence, type FieldTask, type Well } from "../sim";
import type { Selection } from "../render/plate/map";
import { nextStep } from "./advice";

interface Props {
  runtime: GameRuntime;
  snap: Snapshot;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onStake: () => void;
  onOpenRig: () => void;
  onOpenBooks: () => void;
}

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"];
const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

function taskLine(task: FieldTask, snap: Snapshot): string {
  const back = `back ${formatDate(task.until)} at evening`;
  if (task.kind === "walk") return `The party is walking the ${SURVEYS.find((s) => s.id === task.surveyId)?.name ?? ""} survey; ${back}.`;
  if (task.kind === "inquire") return `Gone to ask ${snap.print.wells.find((w) => w.id === task.wellId)?.owner ?? "a settler"} about his well; ${back}.`;
  return task.who === "geologist" ? `A geologist is coming from Austin; ${back}.` : `Asking around Beaumont; ${back}.`;
}

function evidenceLine(e: Evidence): { text: string; src: string; red?: boolean } {
  const when = formatDate(e.t);
  switch (e.kind) {
    case "surfaceSign": {
      const what = { mound: `A low rise, some ${e.reliefFt ?? "?"} ft above the prairie.`, gasSeep: "Gas bubbling up through standing water.", sourSpring: "A sour spring; the water smells of sulphur.", paraffinDirt: "Waxy, dark dirt that burns." }[e.sign];
      return { text: what, src: `Seen by the party, ${when} · ${e.strength}`, red: e.sign !== "mound" };
    }
    case "walked":
      return { text: e.found ? `Walked the survey: ${e.found} sign${e.found > 1 ? "s" : ""} noted.` : "Walked the survey: nothing out of the ordinary.", src: `${when}` };
    case "opinion":
      return { text: e.text, src: `${e.from === "geologist" ? "A geologist from Austin" : "Talk in Beaumont"}, ${when} · ${e.stance}` };
    case "sample":
      return { text: `Bailer sample, ${e.topFt}–${e.baseFt} ft: ${e.call}.`, src: `Our own well, ${when}`, red: !!e.show };
    case "wellRecord":
      return { text: `${e.owner}'s water well (${e.year}), ${e.depthFt} ft. ${e.intervals.length} beds described.`, src: `His account, ${when} · ${memoryWord(e.memory)}`, red: e.intervals.some((i) => i.show) };
  }
}

/** The land: the owner's terms, or the company's lease on it. Public information only. */
function LeaseBlock({ runtime, snap, surveyId }: { runtime: GameRuntime; snap: Snapshot; surveyId: string }) {
  const survey = SURVEYS.find((x) => x.id === surveyId)!;
  const lease = activeLease(snap.ops.leases, surveyId, snap.time);
  if (lease) {
    return (
      <div class="lease lease-ours" data-testid="lease">
        <h3>The company's lease</h3>
        <p>
          {lease.acres} acres, one-eighth royalty to {survey.owner}. Runs to <b>{formatDate(lease.expiresAt)}</b>
          {lease.renewals ? `, renewed ${lease.renewals} time${lease.renewals > 1 ? "s" : ""}` : ""}.
        </p>
        <p class="empty">Held while a well is drilled on it; otherwise renewed on a delay rental if the money is there.</p>
        <div class="acts"><button type="button" class="button button-quiet" onClick={() => runtime.command("lease.release", { surveyId })}>Release the lease</button></div>
      </div>
    );
  }
  const wells = snap.ops.well ? [...snap.ops.past, snap.ops.well] : snap.ops.past;
  const strikes = wells.filter((w) => w.status === "gusher" && w.outcome?.startsWith("OIL")).map((w) => ({ x: w.x, y: w.y }));
  const t = askingTerms(survey, snap.print, { strikes });
  const refused = (snap.ops.leases.refusedUntil[surveyId] ?? -1) > snap.time;
  const lapsed = snap.ops.leases.leases.some((l) => l.surveyId === surveyId && l.status === "lapsed");
  return (
    <div class="lease" data-testid="lease">
      <h3>The land</h3>
      <p>
        {survey.owner} asks <b>{dollars(t.askingCents / 100)}</b> bonus for a one-year lease of {t.acres} acres, with a one-eighth royalty on any oil sold.
        {t.reasons.length ? ` The price is up: ${t.reasons.join(", ")}.` : ""}
      </p>
      {lapsed && <p class="empty">Your earlier lease here has lapsed.</p>}
      <div class="acts">
        <button type="button" class="button button-primary" data-testid="lease-asking" disabled={snap.ops.cash < t.askingCents / 100} onClick={() => runtime.command("lease.take", { surveyId, offer: "asking" })}>
          Lease it<small>{dollars(t.askingCents / 100)}</small>
        </button>
        <button type="button" class="button" data-testid="lease-lower" disabled={refused || snap.ops.cash < t.lowerCents / 100} onClick={() => runtime.command("lease.take", { surveyId, offer: "lower" })}>
          Offer {dollars(t.lowerCents / 100)}<small>{refused ? "refused this month" : "the owner may refuse"}</small>
        </button>
      </div>
    </div>
  );
}

const dollars = (n: number) => "$" + Math.floor(n).toLocaleString("en-US");
const stakeNote = () => `${dollars(COSTS.rigUp)} to raise a derrick, then tap the spot`;

function wellWords(w: Well): string {
  if (w.status === "rigging") return "· the derrick is going up";
  if (w.status === "gusher") return `· came in at ${Math.floor(w.depthFt)} ft`;
  if (w.status === "dry") return `· dry at ${Math.floor(w.depthFt)} ft`;
  return `· ${Math.floor(w.depthFt)} ft${w.status === "stuck" ? ", tools stuck" : ""}`;
}

const memoryWord = (m: number) => (m > 0.85 ? "remembers well" : m > 0.7 ? "fair memory" : "hazy memory");

export function FieldNotes({ runtime, snap, selection, onSelect, onStake, onOpenRig, onOpenBooks }: Props) {
  const k = snap.knowledge;
  const task = k.task;
  const act = (type: string, payload: Record<string, string>) => () => runtime.command(type, payload);

  const well = snap.ops.well;
  const drilling = !!well && well.status !== "gusher" && well.status !== "dry";
  const wellLine = well ? (
    <div class="well-line">
      <p>
        <b>{well.name}</b> {wellWords(well)}
      </p>
      <button type="button" class="button button-primary" data-testid="to-rig" onClick={onOpenRig}>Go to the rig</button>
    </div>
  ) : null;
  const producers = snap.ops.production.producers;
  const busy = (
    <>
      {task ? <p class="task" data-testid="task">{taskLine(task, snap)}</p> : null}
      {wellLine}
      {producers.length > 0 && (
        <div class="producing" data-testid="producing">
          {producers.map((p) => (
            <p key={p.wellId}><b>{p.name}</b> · producing {p.lastDayBbl} bbl a day · {p.monthBbl.toLocaleString("en-US")} bbl hauled this month</p>
          ))}
        </div>
      )}
    </>
  );

  if (selection?.kind === "survey") {
    const s = SURVEYS.find((x) => x.id === selection.id);
    if (!s) return null;
    const wellsHere = snap.print.wells.filter((w) => insidePoly(s.poly, w.x, w.y));
    const leased = !!activeLease(snap.ops.leases, s.id, snap.time);
    const items = k.evidence.filter((e) => ("surveyId" in e && e.surveyId === s.id) || (e.kind === "wellRecord" && wellsHere.some((w) => w.id === e.wellId)));
    return (
      <section class="notes-body" aria-labelledby="notes-h">
        <h2 id="notes-h">{s.name} Survey</h2>
        <p class="sub">Abstract {s.abstract} · {s.acres} acres · {s.owner}</p>
        {busy}
        <h3>What we know</h3>
        {items.length === 0 ? (
          <p class="empty">Nothing is known of this survey yet. Blank paper means unknown, not empty.</p>
        ) : (
          <ol class="ev" data-testid="evidence">
            {items.map((e, i) => { const l = evidenceLine(e); return (
              <li key={e.id}><span class="num">{ROMAN[i] ?? i + 1}.</span><span class={l.red ? "red" : ""}>{l.text}<small>{l.src}</small></span></li>
            ); })}
          </ol>
        )}
        {wellsHere.length > 0 && (
          <p class="wells-here">Water well{wellsHere.length > 1 ? "s" : ""} on this survey: {wellsHere.map((w, i) => (
            <button type="button" class="link" key={w.id} onClick={() => onSelect({ kind: "well", id: w.id })}>{w.owner}'s{i < wellsHere.length - 1 ? ", " : ""}</button>
          ))}</p>
        )}
        <div class="acts">
          <button type="button" class="button button-primary" disabled={!!task} onClick={act("fieldwork.walk", { surveyId: s.id })}>Walk the ground<small>{days(WALK_DAYS(s.acres))}</small></button>
          <button type="button" class="button" disabled={!!task} onClick={act("fieldwork.consult", { surveyId: s.id, who: "gossip" })}>Ask in Beaumont<small>{days(CONSULT_DAYS.gossip)}</small></button>
          <button type="button" class="button" disabled={!!task} onClick={act("fieldwork.consult", { surveyId: s.id, who: "geologist" })}>Send for a geologist<small>{days(CONSULT_DAYS.geologist)}</small></button>
        </div>
        <LeaseBlock runtime={runtime} snap={snap} surveyId={s.id} />
        <div class="acts">
          <button type="button" class="button button-drill" data-testid="stake" disabled={drilling || !leased || !snap.ops.bank.rigOwned || !!snap.ops.contract || !!snap.ops.outcome.ended || snap.ops.cash < COSTS.rigUp} onClick={onStake}>
            Stake a well here<small>{snap.ops.outcome.ended ? "the company is finished" : !snap.ops.bank.rigOwned ? "the company has no rig" : snap.ops.contract ? "the rig is out on contract" : drilling ? "one rig at a time" : !leased ? "lease the land first" : stakeNote()}</small>
          </button>
        </div>
      </section>
    );
  }

  if (selection?.kind === "well") {
    const w = snap.print.wells.find((x) => x.id === selection.id);
    if (!w) return null;
    const rec = k.evidence.find((e) => e.kind === "wellRecord" && e.wellId === w.id);
    return (
      <section class="notes-body" aria-labelledby="notes-h">
        <h2 id="notes-h">{w.owner}'s water well</h2>
        <p class="sub">A settler's well, dug for stock water</p>
        {busy}
        {rec && rec.kind === "wellRecord" ? (
          <>
            <h3>As {w.owner} tells it</h3>
            <table class="log" data-testid="log">
              <thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">His words</th></tr></thead>
              <tbody>{rec.intervals.map((iv, i) => (
                <tr key={i} class={iv.show ? "red" : ""}><td>{iv.topFt}</td><td>{iv.baseFt}</td><td>{iv.call}</td></tr>
              ))}</tbody>
            </table>
            <p class="empty">Feet below the surface, as he remembers them ({memoryWord(rec.memory)}). Below {rec.depthFt} ft nothing is known.</p>
          </>
        ) : (
          <>
            <p class="empty">Nobody has asked {w.owner} what his well went through. Its record is unknown.</p>
            <div class="acts"><button type="button" class="button button-primary" disabled={!!task} onClick={act("fieldwork.inquire", { wellId: w.id })}>Ask {w.owner} about his well<small>{days(INQUIRE_DAYS)}</small></button></div>
          </>
        )}
      </section>
    );
  }

  if (selection?.kind === "section" || selection?.kind === "prospect") {
    const sec = selection.kind === "section" ? k.interp.sections.find((s) => s.id === selection.id) : undefined;
    const pro = selection.kind === "prospect" ? k.interp.prospects.find((p) => p.id === selection.id) : undefined;
    if (!sec && !pro) return null;
    return (
      <section class="notes-body" aria-labelledby="notes-h">
        <h2 id="notes-h">{sec ? `Section ${sec.letter}—${sec.letter}′` : `Prospect ${pro!.numeral}`}</h2>
        <p class="sub">{sec ? "A line of section, pencilled by you" : "Your own conjecture: where you believe the structure lies"}</p>
        {busy}
        <p class="empty">{sec ? "Fig. 2 shows the ground along this line, built only from records the company holds. Correlations between wells are dashed because they are inferred." : "Drawn dotted because it is a guess. It changes nothing in the ground; it is a note to yourself."}</p>
        <div class="acts"><button type="button" class="button" onClick={() => { runtime.command(sec ? "interp.section.remove" : "interp.prospect.remove", { id: (sec ?? pro)!.id }); onSelect(null); }}>Rub it out</button></div>
      </section>
    );
  }

  const signs = k.evidence.filter((e) => e.kind === "surfaceSign").length;
  const records = k.evidence.filter((e) => e.kind === "wellRecord").length;
  return (
    <section class="notes-body" aria-labelledby="notes-h">
      <h2 id="notes-h">Field notes</h2>
      <p class="sub">Spring 1890. Somewhere under this prairie, perhaps, is oil.</p>
      <div class="goal" data-testid="goal">
        <p class="goal-head" data-testid="goal-head">{snap.ops.outcome.ended ? "The company is finished." : snap.ops.outcome.firstOilAt !== null ? "You brought in a producing well." : "Bring in a well before the money runs out."}</p>
        {snap.ops.outcome.firstOilAt !== null && !snap.ops.outcome.ended && <p>The {snap.ops.outcome.firstOilWell} has sold oil since {formatDate(snap.ops.outcome.firstOilAt)}. What the company becomes now is up to you.</p>}
        <p>You have <b>{dollars(snap.ops.cash)}</b>{snap.ops.debt > 0 ? <> and owe the bank <b>{dollars(Math.ceil(snap.ops.debt))}</b></> : null}, {snap.ops.bank.rigOwned ? (snap.ops.contract ? "a rig out on contract" : "one rig") : "no rig"} and a driller. Every day of drilling costs ${snap.ops.dayRate % 1 ? snap.ops.dayRate.toFixed(2) : snap.ops.dayRate}, and raising a derrick costs {dollars(COSTS.rigUp)}.</p>
        <p class="goal-next" data-testid="next"><b>Next:</b> {nextStep({ ops: snap.ops, paths: snap.paths, knowledge: snap.knowledge, formatDate: (t) => formatDate(t), surveyName: (id) => SURVEYS.find((x) => x.id === id)?.name ?? "" })}</p>
        <div class="acts"><button type="button" class="button button-quiet" data-testid="open-books" onClick={onOpenBooks}>The books and the bank</button></div>
      </div>
      {busy}
      <p class="empty">Print is the county survey anyone can buy. Red is the company's own hand. Blank paper means unknown, not empty.</p>
      <p class="tally">{signs} sign{signs === 1 ? "" : "s"} seen · {records} well record{records === 1 ? "" : "s"} · {k.interp.sections.length} section{k.interp.sections.length === 1 ? "" : "s"} · {k.interp.prospects.length} prospect{k.interp.prospects.length === 1 ? "" : "s"}</p>
    </section>
  );
}
