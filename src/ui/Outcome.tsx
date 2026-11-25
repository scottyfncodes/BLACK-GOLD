import { useEffect, useRef, useState } from "preact/hooks";
import { formatDate, randomSeed, type GameRuntime, type Snapshot } from "../app/runtime";
import { CAMPAIGN_START, HAUL_LIMIT_BBL, HAULING_CENTS, MINUTES_PER_DAY, OIL_PRICE_CENTS, ROYALTY, type Category } from "../sim";

/**
 * The campaign's two verdicts, said plainly: the first producing well (the goal met), and the
 * end, when the company has no way forward left. Both are drawn only from the company's own
 * records: its books, its wells and what it has learned.
 */

const usd = (cents: number) => "$" + Math.round(cents / 100).toLocaleString("en-US");
const HEADS: Partial<Record<Category, string>> = { lease: "land", drilling: "drilling", operating: "crew and rig time", equipment: "rig and tools", production: "hauling and royalty", bank: "the bank" };

function spentBy(snap: Snapshot): { label: string; cents: number }[] {
  const by = new Map<string, number>();
  for (const e of snap.ops.ledger.entries) {
    const cash = e.lines.filter((l) => l.account === "cash").reduce((a, l) => a + l.cents, 0);
    if (cash >= 0 || e.category === "opening") continue;
    const label = HEADS[e.category] ?? e.category;
    by.set(label, (by.get(label) ?? 0) - cash);
  }
  return [...by.entries()].map(([label, cents]) => ({ label, cents })).sort((a, b) => b.cents - a.cents);
}

/** A modal sheet that opens itself when `open` turns true. */
function useSheet(open: boolean, runtime: GameRuntime) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { runtime.setSpeed("paused"); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open, runtime]);
  return ref;
}

/** The first producing well: the goal of the campaign, met. */
export function FirstOil({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const open = snap.milestone !== null && snap.ops.outcome.firstOilAt !== null;
  const ref = useSheet(open, runtime);
  const o = snap.ops.outcome;
  const wells = snap.ops.past.length + (snap.ops.well ? 1 : 0);
  const days = o.firstOilAt !== null ? Math.round((o.firstOilAt - CAMPAIGN_START) / MINUTES_PER_DAY) : 0;
  const net = OIL_PRICE_CENTS - HAULING_CENTS - Math.round(OIL_PRICE_CENTS * ROYALTY);
  const spent = spentBy(snap).reduce((a, s) => a + s.cents, 0);
  const close = () => runtime.dismissMilestone();
  return (
    <dialog ref={ref} class="sheet outcome" aria-labelledby="first-oil-title" data-testid="first-oil" onClose={close}>
      {open && (
        <div class="sheet-body">
          <p class="outcome-kicker">The goal is met</p>
          <h2 id="first-oil-title" class="outcome-title">A producing well.</h2>
          <p class="outcome-lede">The {o.firstOilWell} is capped, and its oil will be hauled to Beaumont and sold at every month's end. The company is in the oil business.</p>
          <dl class="position">
            <div><dt>First oil</dt><dd>{formatDate(o.firstOilAt!)}</dd></div>
            <div><dt>Days from the start</dt><dd>{days}</dd></div>
            <div><dt>Wells drilled</dt><dd>{wells}</dd></div>
            <div><dt>Spent to get here</dt><dd>{usd(spent)}</dd></div>
          </dl>
          <p class="meta">Wagons carry up to {HAUL_LIMIT_BBL} barrels a day: about {usd(HAUL_LIMIT_BBL * 30 * net)} a month after hauling and the owner's royalty, while the well flows. What the company becomes now is up to you.</p>
          <div class="row"><button type="button" class="button button-primary" data-testid="carry-on" onClick={close}>Carry on</button></div>
        </div>
      )}
    </dialog>
  );
}

/** The end: no oil, no money and no credit left to try again. */
export function CampaignOver({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const o = snap.ops.outcome;
  const key = o.endedAt !== null ? `${snap.seed}:${o.endedAt}` : "";
  const [seen, setSeen] = useState("");
  const open = key !== "" && seen !== key;
  const ref = useSheet(open, runtime);
  const wells = snap.ops.well ? [...snap.ops.past, snap.ops.well] : snap.ops.past;
  const k = snap.knowledge.evidence;
  const spent = spentBy(snap);
  const total = spent.reduce((a, s) => a + s.cents, 0);
  const debt = Math.round(snap.ops.debt * 100);
  const close = () => setSeen(key);
  return (
    <dialog ref={ref} class="sheet outcome" aria-labelledby="over-title" data-testid="campaign-over" onClose={close}>
      {open && (
        <div class="sheet-body">
          <p class="outcome-kicker">{formatDate(CAMPAIGN_START)} – {formatDate(o.endedAt!)}</p>
          <h2 id="over-title" class="outcome-title">The company is finished.</h2>
          <p class="outcome-lede">
            No oil is selling, and the money and the bank's credit left will not raise a derrick or pay a crew for contract work. {debt > 0 ? `It owes the bank ${usd(debt)}.` : ""}
          </p>
          <h3>The wells</h3>
          {wells.length ? (
            <ol class="outcome-wells">
              {wells.map((w) => (
                <li key={w.id}><b>{w.name}</b> · {w.status === "gusher" ? (w.outcome?.startsWith("GAS") ? "gas" : "oil") : "dry"} at {Math.floor(w.depthFt).toLocaleString("en-US")} ft</li>
              ))}
            </ol>
          ) : <p class="meta">None drilled.</p>}
          <h3>The money</h3>
          <p class="meta">{usd(total)} spent: {spent.map((s) => `${usd(s.cents)} on ${s.label}`).join(", ")}.</p>
          <h3>What was learned</h3>
          <p class="meta">
            {k.filter((e) => e.kind === "surfaceSign").length} surface signs, {k.filter((e) => e.kind === "sample").length} bailer samples and {k.filter((e) => e.kind === "wellRecord").length} settlers' well records. The ground is different in every campaign; the way of reading it is not.
          </p>
          <div class="row">
            <button type="button" class="button button-primary" data-testid="new-campaign" onClick={() => void runtime.newCampaign(randomSeed())}>Start a new campaign</button>
            <button type="button" class="button" onClick={close}>Look over the plate</button>
          </div>
        </div>
      )}
    </dialog>
  );
}
