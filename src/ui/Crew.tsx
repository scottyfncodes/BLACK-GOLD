import { useEffect, useRef } from "preact/hooks";
import { formatDate, type GameRuntime, type Snapshot } from "../app/runtime";
import { PIPE, type DrillerRecord } from "../sim";

/**
 * The driller: his advice, his record and the men who might replace him. Everything here is what
 * the company has heard or seen: reputation, recommendations, outcomes. Never his true ability.
 */

const usd = (cents: number) => "$" + (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));
/** Prices for a decision: whole dollars, rounded up, as a driller would quote them. */
const quote = (cents: number) => "$" + Math.ceil(cents / 100).toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** His recommendation and the two or three things the player can do about it. */
export function AdviceCard({ runtime, snap, onOpenRig }: { runtime: GameRuntime; snap: Snapshot; onOpenRig?: () => void }) {
  const p = snap.ops.crew.pending, w = snap.ops.well;
  if (!p || !w || w.id !== p.wellId) return null;
  const pipe = PIPE[w.strings.length];
  const yes = p.kind === "case" ? `Set the ${pipe?.name ?? "pipe"}` : p.kind === "drive" ? `Drive the ${pipe?.name ?? "pipe"}` : p.kind === "setdrive" ? "Set it here" : p.kind === "fish" ? (w.collapse ? "Swaging job" : "Fishing job") : "Plug the hole";
  const no = p.kind === "abandon" ? "Keep at it" : p.kind === "quit" ? "Keep drilling" : p.kind === "setdrive" ? "Drive on" : p.kind === "drive" ? "Not yet" : "Drill on";
  // With nothing seen either way he recommends nothing: neither choice is set as his.
  const open = p.kind === "decide";
  return (
    <div class="advice" role="group" aria-label="The driller's advice" data-testid="advice">
      <p class="advice-who">{snap.ops.crew.driller.name}, the driller</p>
      <p class="advice-text">“{p.text}”</p>
      {open && <p class="advice-open" data-testid="advice-open">He makes no recommendation: the choice is yours.</p>}
      <div class="row">
        <button type="button" class={`button ${open ? "" : "button-primary"}`} data-testid="advice-yes" onClick={() => runtime.command("crew.accept", { id: p.id })}>
          {yes}{p.costCents > 0 && <small>{quote(p.costCents)}</small>}
        </button>
        <button type="button" class="button" data-testid="advice-no" onClick={() => runtime.command("crew.decline", { id: p.id })}>
          {no}
        </button>
        {onOpenRig && <button type="button" class="button button-quiet" data-testid="advice-rig" onClick={onOpenRig}>Look at the rig first</button>}
      </div>
    </div>
  );
}

/** On the map, his advice comes as a sheet: the clock has stopped for it. */
export function AdviceSheet({ runtime, snap, hidden, onOpenRig }: { runtime: GameRuntime; snap: Snapshot; hidden: boolean; onOpenRig: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const p = snap.ops.crew.pending;
  const open = !hidden && !!p && snap.ops.well?.id === p.wellId;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} class="sheet advice-sheet" aria-label="The driller's advice" data-testid="advice-sheet">
      {open && <div class="sheet-body"><AdviceCard runtime={runtime} snap={snap} onOpenRig={onOpenRig} /></div>}
    </dialog>
  );
}

/** What the company has seen him do, in plain sentences. */
export function recordLines(r: DrillerRecord | undefined): string[] {
  if (!r || r.wells === 0) return ["Nothing yet: he has not drilled for the company."];
  const out = [`${plural(r.wells, "well")} in his charge; ${r.feet.toLocaleString("en-US", { maximumFractionDigits: 0 })} ft made with the tools in his hands, over ${plural(Math.round(r.ticks / 288), "day")}.`];
  out.push(r.stuck ? `Tools stuck ${plural(r.stuck, "time")}; ${plural(r.fishing, "fishing job")}.` : "Never had the tools stuck.");
  if (r.strings) out.push(`${plural(r.strings, "string")} of casing set: ${r.dryStrings} shut off the water, ${r.leakyStrings} did not${r.strings - r.dryStrings - r.leakyStrings > 0 ? `, ${r.strings - r.dryStrings - r.leakyStrings} not yet tested` : ""}.`);
  const ends = [r.oil && `${plural(r.oil, "well")} came in with oil${r.wet ? ` (${r.wet} cut with water)` : ""}`, r.dry && `${plural(r.dry, "well")} ended dry or abandoned`].filter(Boolean);
  if (ends.length) out.push(`${ends.join("; ")}.`);
  return out;
}

/** The crew sheet: the driller, his record and notes, standing orders, and men looking for work. */
export function CrewSheet({ runtime, snap, open, onClose }: { runtime: GameRuntime; snap: Snapshot; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { runtime.setSpeed("paused"); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open, runtime]);
  const crew = snap.ops.crew, d = crew.driller, o = crew.orders;
  const w = snap.ops.well;
  const busy = !!w && (w.status === "rigging" || w.status === "drilling" || w.status === "stuck" || !!w.pullingUntil);
  const setOrders = (authority: "ask" | "judgement", budgetCents = o.budgetCents) => runtime.command("crew.orders", { authority, budgetCents });
  return (
    <dialog ref={ref} class="sheet crew" aria-labelledby="crew-title" data-testid="crew" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      {open && (
        <div class="sheet-body">
          <header class="sheet-head">
            <h2 id="crew-title">The Crew</h2>
            <button type="button" class="button button-quiet" onClick={onClose}>Close</button>
          </header>
          <section class="sheet-section" aria-labelledby="driller-h">
            <h3 id="driller-h">Your driller</h3>
            <p class="crew-name">{d.name}</p>
            <p class="meta">{plural(d.years, "year")} at the work · from {d.from} · {usd(d.wageCents)} a day</p>
            <p class="crew-remark">{d.remark}</p>
            <h4>What the company has seen</h4>
            <ul class="crew-record" data-testid="record">{recordLines(crew.records[d.id]).map((l) => <li key={l}>{l}</li>)}</ul>
            {crew.notes.length > 0 && (
              <>
                <h4>His notes</h4>
                <ol class="crew-notes">
                  {crew.notes.slice(-6).reverse().map((n, i) => <li key={i}><span class="meta">{formatDate(n.t)}</span> {n.text}</li>)}
                </ol>
              </>
            )}
          </section>
          <section class="sheet-section" aria-labelledby="orders-h" data-testid="orders">
            <h3 id="orders-h">Standing orders</h3>
            <div class="row" role="radiogroup" aria-label="When he spends money">
              <button type="button" role="radio" aria-checked={o.authority === "ask"} class={`button ${o.authority === "ask" ? "button-primary" : ""}`} data-testid="orders-ask" onClick={() => setOrders("ask")}>Ask before spending</button>
              <button type="button" role="radio" aria-checked={o.authority === "judgement"} class={`button ${o.authority === "judgement" ? "button-primary" : ""}`} data-testid="orders-judgement" onClick={() => setOrders("judgement")}>Use his judgement</button>
            </div>
            {o.authority === "judgement" ? (
              <>
                <p class="meta">He may spend up to <b>{usd(o.budgetCents)}</b> a calendar month on pipe and fishing without asking ({usd(o.spentCents)} so far this month). He never plugs a hole without asking, and never spends below what the company needs to start again.</p>
                <div class="row">
                  <button type="button" class="button" data-testid="budget-less" disabled={o.budgetCents <= 5_000} onClick={() => setOrders("judgement", o.budgetCents - 5_000)}>− $50</button>
                  <button type="button" class="button" data-testid="budget-more" disabled={o.budgetCents >= 50_000} onClick={() => setOrders("judgement", o.budgetCents + 5_000)}>+ $50</button>
                </div>
              </>
            ) : (
              <p class="meta">He tells you what he sees and what he would do, and the clock stops until you answer.</p>
            )}
          </section>
          <section class="sheet-section" aria-labelledby="hire-h" data-testid="candidates">
            <h3 id="hire-h">Men looking for work in Beaumont</h3>
            {busy && <p class="meta">A driller is changed between wells, not in the middle of one.</p>}
            {crew.candidates.length === 0 ? <p class="meta">Nobody this month.</p> : crew.candidates.map((c) => (
              <div key={c.id} class="candidate">
                <p class="crew-name">{c.name}</p>
                <p class="meta">{plural(c.years, "year")} · from {c.from} · {usd(c.wageCents)} a day</p>
                <p class="crew-remark">{c.remark}</p>
                <button type="button" class="button" data-testid="hire" disabled={busy} onClick={() => runtime.command("crew.hire", { id: c.id })}>Hire {c.name.split(" ")[0]}</button>
              </div>
            ))}
          </section>
        </div>
      )}
    </dialog>
  );
}
