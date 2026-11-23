import type { GameRuntime, Snapshot } from "../app/runtime";
import { formatDate } from "../app/runtime";
import { SURVEYS, insidePoly } from "../content/geography/surveys";
import { CONSULT_DAYS, INQUIRE_DAYS, WALK_DAYS, type Evidence, type FieldTask } from "../sim";
import type { Selection } from "../render/plate/map";

interface Props {
  runtime: GameRuntime;
  snap: Snapshot;
  selection: Selection;
  onSelect: (s: Selection) => void;
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
    case "wellRecord":
      return { text: `${e.owner}'s water well (${e.year}), ${e.depthFt} ft. ${e.intervals.length} beds described.`, src: `His account, ${when} · ${memoryWord(e.memory)}`, red: e.intervals.some((i) => i.show) };
  }
}

const memoryWord = (m: number) => (m > 0.85 ? "remembers well" : m > 0.7 ? "fair memory" : "hazy memory");

export function FieldNotes({ runtime, snap, selection, onSelect }: Props) {
  const k = snap.knowledge;
  const task = k.task;
  const act = (type: string, payload: Record<string, string>) => () => runtime.command(type, payload);

  const busy = task ? <p class="task" data-testid="task">{taskLine(task, snap)}</p> : null;

  if (selection?.kind === "survey") {
    const s = SURVEYS.find((x) => x.id === selection.id);
    if (!s) return null;
    const wellsHere = snap.print.wells.filter((w) => insidePoly(s.poly, w.x, w.y));
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
      {busy}
      <p>Choose a survey on the map to see what is known of it, and send the party out to look. Ask settlers what their wells went through. Draw a line of section to set those records side by side.</p>
      <p class="empty">Print is the county survey anyone can buy. Red is the company's own hand. Blank paper means unknown, not empty.</p>
      <p class="tally">{signs} sign{signs === 1 ? "" : "s"} seen · {records} well record{records === 1 ? "" : "s"} · {k.interp.sections.length} section{k.interp.sections.length === 1 ? "" : "s"} · {k.interp.prospects.length} prospect{k.interp.prospects.length === 1 ? "" : "s"}</p>
    </section>
  );
}
