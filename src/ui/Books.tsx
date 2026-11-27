import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { formatDate, type GameRuntime, type Snapshot } from "../app/runtime";
import {
  ACCRUAL_UNITS,
  BORROW_STEP_CENTS,
  creditLimitCents,
  CONTRACT_DAYS,
  CONTRACT_PAY,
  CONTRACT_WAGES,
  OIL_ADVANCE,
  RATE_PERCENT,
  RIG_ADVANCE,
  RIG_RESALE,
  STRIKES_TO_FORECLOSE,
  toCalendar,
  USED_RIG_PRICE,
  type Category,
  type Entry,
} from "../sim";

const pct = (f: number) => (f === 0.75 ? "three quarters" : f === 0.5 ? "half" : f === 0.2 ? "a fifth" : `${Math.round(f * 100)}%`);

/** Selling the rig: a consequential decision, so it takes a second, informed tap. */
function SellRig({ runtime, book, debt }: { runtime: GameRuntime; book: number; debt: number }) {
  const [asking, setAsking] = useState(false);
  const proceeds = RIG_RESALE * 100;
  const toBank = Math.min(proceeds, debt);
  return (
    <div class="recover sell-rig" data-testid="sell-rig">
      {!asking ? (
        <div class="row">
          <button type="button" class="button" data-testid="sell-rig-ask" onClick={() => setAsking(true)}>
            Sell the rig and tools<small>{wholeDollars(proceeds)} in Beaumont</small>
          </button>
        </div>
      ) : (
        <>
          <p>
            A used outfit fetches <b>{wholeDollars(proceeds)}</b> in Beaumont; this one stands at {wholeDollars(book)} on the books, so the company loses {wholeDollars(Math.max(0, book - proceeds))}.
            {toBank > 0 ? ` The bank is paid first: ${wholeDollars(toBank)} of the price goes against the loan.` : ""} Without a rig the company can neither drill nor take contract work, and a used rig costs {wholeDollars(USED_RIG_PRICE * 100)} to buy back.
          </p>
          <div class="row">
            <button type="button" class="button button-danger" data-testid="sell-rig-confirm" onClick={() => { setAsking(false); runtime.command("company.sellRig", null); }}>
              Sell it<small>{wholeDollars(proceeds)}</small>
            </button>
            <button type="button" class="button" onClick={() => setAsking(false)}>Keep the rig</button>
          </div>
        </>
      )}
    </div>
  );
}

interface Props {
  runtime: GameRuntime;
  snap: Snapshot;
  open: boolean;
  onClose: () => void;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const HEADS: Record<Category, string> = {
  opening: "Capital",
  lease: "Land",
  fieldwork: "Fieldwork",
  drilling: "Drilling",
  equipment: "Rig and tools",
  operating: "Crew",
  production: "Oil",
  bank: "The bank",
};

/** Whole dollars and cents, as a bookkeeper writes them. */
export const money = (cents: number) => "$" + (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeDollars = (cents: number) => "$" + Math.floor(cents / 100).toLocaleString("en-US");

interface Row { e: Entry; cash: number; bal: number }
interface Month { key: string; label: string; rows: Row[]; heads: { cat: Category; out: number; in: number; n: number }[]; open: number; close: number }

/** The cash book: each entry's effect on cash, a running balance, and a month's summary by heading. */
function cashBook(entries: readonly Entry[]): Month[] {
  const months: Month[] = [];
  let bal = 0;
  for (const e of entries) {
    const cash = e.lines.filter((l) => l.account === "cash").reduce((a, l) => a + l.cents, 0);
    const c = toCalendar(e.t);
    const key = `${c.year}-${c.month}`;
    let m = months[months.length - 1];
    if (!m || m.key !== key) {
      m = { key, label: `${MONTHS[c.month - 1]} ${c.year}`, rows: [], heads: [], open: bal, close: bal };
      months.push(m);
    }
    bal += cash;
    m.rows.push({ e, cash, bal });
    m.close = bal;
    let h = m.heads.find((x) => x.cat === e.category);
    if (!h) m.heads.push((h = { cat: e.category, out: 0, in: 0, n: 0 }));
    if (cash < 0) h.out -= cash;
    else h.in += cash;
    h.n++;
  }
  return months.reverse();
}

export function Books({ runtime, snap, open, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      runtime.setSpeed("paused");
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, runtime]);

  const { ledger, bank, production } = snap.ops;
  const months = useMemo(() => (open ? cashBook(ledger.entries) : []), [open, ledger.entries.length]);
  if (!open) return <dialog ref={dialog} class="sheet books" aria-labelledby="books-title" onClose={onClose} />;

  const cash = Math.round(snap.ops.cash * 100);
  const debt = Math.round(snap.ops.debt * 100);
  const booked = months[0]?.close ?? 0;
  const unbooked = booked - cash; // today's rig time, entered at midnight
  const limit = creditLimitCents(bank, production, snap.ops.oilPriceCents);
  const room = Math.max(0, limit - debt);
  const roomSteps = Math.floor(room / BORROW_STEP_CENTS) * BORROW_STEP_CENTS;
  const accruedCents = Math.floor(bank.accrued / ACCRUAL_UNITS);
  const act = (type: string, payload: Record<string, number> | null = null) => () => runtime.command(type, payload);
  const contract = snap.ops.contract;
  const offer = snap.paths.find((p) => p.kind === "contract");
  const w = snap.ops.well;
  const rigBusy = !!w && (w.status === "rigging" || w.status === "drilling" || w.status === "stuck");

  return (
    <dialog ref={dialog} class="sheet books" aria-labelledby="books-title" onClose={onClose} onClick={(e) => e.target === dialog.current && onClose()}>
      <div class="sheet-body">
        <header class="sheet-head">
          <h2 id="books-title">The Company's Books</h2>
          <button type="button" class="button button-quiet" onClick={onClose}>Close</button>
        </header>

        <dl class="position" data-testid="position">
          <div><dt>Cash in hand</dt><dd data-testid="books-cash">{money(cash)}</dd></div>
          <div><dt>Owed to the bank</dt><dd data-testid="books-debt" class={debt > 0 ? "owed" : ""}>{debt > 0 ? money(debt) : "Nothing"}</dd></div>
          <div><dt>Rig and tools</dt><dd>{!bank.rigOwned ? "None" : contract ? "Out on contract" : `Owned · ${wholeDollars(bank.rigBookCents)}`}</dd></div>
          <div><dt>Crude this year</dt><dd data-testid="oil-price">{snap.ops.oilPriceCents}¢ a barrel</dd></div>
          <div><dt>Wells producing</dt><dd>{production.producers.length || "None"}</dd></div>
        </dl>

        <section class="sheet-section bank" aria-labelledby="bank-h" data-testid="bank">
          <h3 id="bank-h">First National Bank of Beaumont</h3>
          {bank.strikes > 0 && (
            <p class="bank-warn" role="alert">
              Last month's interest went unpaid and was added to the loan. {STRIKES_TO_FORECLOSE - bank.strikes === 1 ? "One more unpaid month and the bank forecloses on the rig." : ""}
            </p>
          )}
          {bank.lien ? (
            <p>The bank foreclosed and holds a lien: it takes the oil money first until the loan is clear. It lends nothing more until then.</p>
          ) : (
            <p>
              The bank lends {pct(RIG_ADVANCE)} of what the rig and tools stand at on the books{production.producers.length ? `, and ${pct(OIL_ADVANCE)} of the next half-year of oil money from the wells, at this year's price` : ""}. It will lend up to <b>{wholeDollars(limit)}</b> in all, at {RATE_PERCENT}% a year. Interest is taken from cash at each month's end; repay whenever you like.
            </p>
          )}
          {debt > 0 && accruedCents > 0 && <p class="meta">Interest so far this month: {money(accruedCents)}.</p>}
          <div class="row">
            <button type="button" class="button" data-testid="borrow" disabled={roomSteps < BORROW_STEP_CENTS} onClick={act("bank.borrow", { cents: BORROW_STEP_CENTS })}>
              Borrow {wholeDollars(BORROW_STEP_CENTS)}
            </button>
            {roomSteps > BORROW_STEP_CENTS && (
              <button type="button" class="button" data-testid="borrow-all" onClick={act("bank.borrow", { cents: roomSteps })}>
                Borrow {wholeDollars(roomSteps)}
              </button>
            )}
            <button type="button" class="button" data-testid="repay" disabled={debt <= 0 || cash < Math.min(debt, BORROW_STEP_CENTS)} onClick={act("bank.repay", { cents: Math.min(debt, BORROW_STEP_CENTS) })}>
              Repay {debt > 0 && debt < BORROW_STEP_CENTS ? money(debt) : wholeDollars(BORROW_STEP_CENTS)}
            </button>
            {debt > BORROW_STEP_CENTS && (
              <button type="button" class="button" data-testid="repay-all" disabled={cash < debt} onClick={act("bank.repay", { cents: debt })}>
                Repay it all<small>{money(debt)}</small>
              </button>
            )}
          </div>
          {contract && (
            <div class="recover" data-testid="contract">
              <p>The rig is out on contract to another operator until <b>{formatDate(contract.until)}</b>. The operator pays {wholeDollars(CONTRACT_PAY * 100)} when the job is done.</p>
            </div>
          )}
          {!contract && bank.rigOwned && !rigBusy && offer && (
            <div class="recover" data-testid="contract">
              <p>
                Until the company can afford a well of its own, the rig can drill on contract for another operator: {CONTRACT_DAYS} days, {wholeDollars(CONTRACT_WAGES * 100)} for the crew's wages and fuel now, {wholeDollars(CONTRACT_PAY * 100)} when the job is done. The rig stays the company's.
              </p>
              <div class="row">
                {offer.kind === "contract" && offer.borrowCents > 0 ? (
                  <button type="button" class="button button-primary" data-testid="take-contract" onClick={() => { if (!runtime.command("bank.borrow", { cents: offer.borrowCents })) runtime.command("company.contract", null); }}>
                    Borrow {wholeDollars(offer.borrowCents)} and take a contract<small>{wholeDollars(CONTRACT_PAY * 100)} in {CONTRACT_DAYS} days</small>
                  </button>
                ) : (
                  <button type="button" class="button button-primary" data-testid="take-contract" onClick={act("company.contract")}>
                    Take a contract<small>{wholeDollars(CONTRACT_WAGES * 100)} now · {wholeDollars(CONTRACT_PAY * 100)} in {CONTRACT_DAYS} days</small>
                  </button>
                )}
              </div>
            </div>
          )}
          {bank.rigOwned && !contract && !rigBusy && (
            <SellRig runtime={runtime} book={bank.rigBookCents} debt={debt} />
          )}
          {!bank.rigOwned && (
            <div class="recover" data-testid="recover">
              <p>Without a rig the company can neither drill nor take contract work. A used rig and tools cost {wholeDollars(USED_RIG_PRICE * 100)} in Beaumont.</p>
              <div class="row">
                <button type="button" class="button button-primary" data-testid="buy-rig" disabled={cash < USED_RIG_PRICE * 100} onClick={act("company.buyRig")}>
                  Buy a used rig<small>{wholeDollars(USED_RIG_PRICE * 100)}</small>
                </button>
              </div>
            </div>
          )}
        </section>

        <section class="sheet-section" aria-labelledby="ledger-h">
          <h3 id="ledger-h">The cash book</h3>
          {unbooked > 0 && <p class="meta">Today's rig time, {money(unbooked)}, is entered at midnight.</p>}
          <div class="ledger" data-testid="ledger">
            {months.map((m, i) => (
              <details key={m.key} class="month" open={i === 0}>
                <summary>
                  <span class="month-name">{m.label}</span>
                  <span class="month-bal">{money(m.close)}</span>
                </summary>
                <table class="heads">
                  <thead><tr><th scope="col"><span class="sr-only">Heading</span></th><th scope="col">Paid out</th><th scope="col">Received</th></tr></thead>
                  <tbody>
                    {m.heads.map((h) => (
                      <tr key={h.cat}>
                        <th scope="row">{HEADS[h.cat]}{h.n > 1 ? <small> · {h.n} entries</small> : null}</th>
                        <td class="out">{h.out ? money(h.out) : ""}</td>
                        <td class="in">{h.in ? money(h.in) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <details class="entries">
                  <summary>Every entry</summary>
                  <table class="book">
                    <thead><tr><th scope="col">Date</th><th scope="col">Particulars</th><th scope="col" class="num">Paid out</th><th scope="col" class="num">Received</th><th scope="col" class="num">Balance</th></tr></thead>
                    <tbody>
                      {m.rows.map((r) => (
                        <tr key={r.e.id} class={r.cash === 0 ? "nocash" : ""}>
                          <td class="date">{toCalendar(r.e.t).day}</td>
                          <td>{r.e.memo}</td>
                          <td class="num">{r.cash < 0 ? money(r.cash) : ""}</td>
                          <td class="num">{r.cash > 0 ? money(r.cash) : ""}</td>
                          <td class="num">{money(r.bal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </details>
            ))}
          </div>
        </section>
      </div>
    </dialog>
  );
}
