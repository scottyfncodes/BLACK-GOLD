import { useEffect, useRef } from "preact/hooks";
import { formatDate } from "../app/runtime";
import { MAX_STRINGS, PIPE, type CasingString, type Well } from "../sim";

/**
 * The casing in a hole, inspectable: each string's size, depth, cost, the seat as the bailer
 * described it, and what the crew has seen it do. Only what has been drilled and seen: nothing
 * below the bit.
 */

const usd = (cents: number) => "$" + (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });

export const SEEN: Record<CasingString["observed"], string> = {
  pending: "Not yet tested: the next bail will show what it does.",
  dry: "The hole bails dry above its shoe: it shut off the water.",
  water: "It holds the walls up, but water still comes in past it.",
  sand: "Sand still works in beneath its shoe.",
};

export function CasingSheet({ well, open, onClose }: { well: Well; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const left = PIPE.slice(well.strings.length).map((p) => p.name);
  return (
    <dialog ref={ref} class="sheet casing" aria-labelledby="casing-title" data-testid="casing-sheet" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      {open && (
        <div class="sheet-body">
          <header class="sheet-head">
            <h2 id="casing-title">Casing in the {well.name}</h2>
            <button type="button" class="button button-quiet" onClick={onClose}>Close</button>
          </header>
          {well.strings.length === 0 ? (
            <p class="meta">No pipe in the hole yet. Up to {MAX_STRINGS} strings can be set, each smaller than the last: {PIPE.map((p) => p.name).join(", ")}.</p>
          ) : (
            <ol class="strings" data-testid="strings">
              {well.strings.map((s, i) => (
                <li key={i} class={`string string-${s.observed}${s.pulled ? " string-pulled" : ""}`}>
                  <p class="string-head"><b>{PIPE[s.size]!.name}</b> to {s.seatFt.toLocaleString("en-US")} ft <span class="meta">· {s.costCents ? usd(s.costCents) : "paid before"} · set {formatDate(s.setAt)}</span></p>
                  <p>Seat: {s.seatCall ? <>in {s.seatCall.split(",")[0]}, as the bailer brought it up</> : "not bailed: what it sits on was never seen"}.</p>
                  <p class="string-seen">{s.pulled ? "Pulled and sold." : SEEN[s.observed]}</p>
                </li>
              ))}
            </ol>
          )}
          <dl class="casing-facts">
            <div><dt>Pipe left</dt><dd>{left.length ? left.join(", ") : "None: the rest of this hole is open."}</dd></div>
            <div><dt>Open sand below the last shoe</dt><dd>{Math.round(well.openSandFt)} ft</dd></div>
            <div><dt>Where the hole made water</dt><dd>{well.waterFt.length ? well.waterFt.map(([a, b]) => `${Math.round(a)}–${Math.round(b)} ft`).join(", ") : "Nowhere yet."}</dd></div>
          </dl>
          <p class="meta">Pipe landed in clay or rock seals; pipe in sand only steadies the walls. What a seat does shows at the next bail.</p>
        </div>
      )}
    </dialog>
  );
}
