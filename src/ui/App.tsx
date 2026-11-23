import { useCallback, useEffect, useState } from "preact/hooks";
import { formatClock, formatDate, type GameRuntime, type Snapshot, type Speed } from "../app/runtime";
import type { Selection } from "../render/plate/map";
import { Books } from "./Books";
import { CampaignMenu } from "./CampaignMenu";
import { FieldNotes } from "./FieldNotes";
import { MapFigure, type Tool } from "./MapFigure";
import { RigView } from "./RigView";
import { SectionFigure } from "./SectionFigure";

function useSnapshot(runtime: GameRuntime): Snapshot {
  const [snap, setSnap] = useState(runtime.snapshot());
  useEffect(() => {
    const unsubscribe = runtime.subscribe(() => setSnap(runtime.snapshot()));
    // Effects run after paint: catch up on anything that changed before we subscribed.
    setSnap(runtime.snapshot());
    return unsubscribe;
  }, [runtime]);
  return snap;
}

const SPEEDS: { speed: Speed; label: string; title: string; key: string }[] = [
  { speed: "paused", label: "Pause", title: "Pause (Space)", key: " " },
  { speed: "1x", label: "1×", title: "Normal speed: an hour a second (1)", key: "1" },
  { speed: "4x", label: "4×", title: "Fast: four hours a second (2)", key: "2" },
  { speed: "16x", label: "16×", title: "Faster: sixteen hours a second (3)", key: "3" },
  { speed: "skip", label: "Skip", title: "Run until something needs you, at most to the start of next month (4)", key: "4" },
];

/** The weekday gives way first when the clock bar is narrow. */
function dateParts(t: number) {
  const long = formatDate(t, "long");
  const i = long.indexOf(", ");
  return i < 0 ? long : <><span class="weekday">{long.slice(0, i + 2)}</span>{long.slice(i + 2)}</>;
}
const usd = (n: number) => "$" + Math.floor(n).toLocaleString("en-US");
const cashWords = (snap: Snapshot) => `${usd(snap.ops.cash)} in hand${snap.ops.debt > 0 ? `, ${usd(Math.ceil(snap.ops.debt))} owed to the bank` : ""}`;

export function App({ runtime }: { runtime: GameRuntime }) {
  const snap = useSnapshot(runtime);
  const [menuOpen, setMenuOpen] = useState(false);
  const [booksOpen, setBooksOpen] = useState(false);
  const openBooks = useCallback(() => setBooksOpen(true), []);
  const [selection, setSelection] = useState<Selection>(null);
  const onSelect = useCallback((s: Selection) => setSelection(s), []);
  const [tool, setTool] = useState<Tool>("select");
  const [rigOpen, setRigOpen] = useState(false);
  const openRig = useCallback(() => setRigOpen(true), []);

  // Forget a selection that no longer exists (rubbed out, or a different world loaded).
  useEffect(() => {
    if (selection?.kind === "section" && !snap.knowledge.interp.sections.some((s) => s.id === selection.id)) setSelection(null);
    if (selection?.kind === "prospect" && !snap.knowledge.interp.prospects.some((p) => p.id === selection.id)) setSelection(null);
  }, [snap.rev, selection]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (menuOpen || booksOpen || rigOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) {
        if (e.key === " ") return;
      }
      if (e.key === " ") {
        e.preventDefault();
        runtime.togglePause();
        return;
      }
      if (e.key === "Escape") setSelection(null);
      const match = SPEEDS.find((s) => s.key === e.key);
      if (match) runtime.setSpeed(match.speed);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runtime, menuOpen, booksOpen, rigOpen]);

  const sections = snap.knowledge.interp.sections;
  const line = selection?.kind === "section" ? sections.find((s) => s.id === selection.id) : sections[sections.length - 1];

  const showRig = rigOpen && !!snap.ops.well;
  return (
    <>
    {/* While the rig is open, the plate behind it is inert: not focusable, not announced. */}
    <div class="plate" inert={showRig} aria-hidden={showRig ? "true" : undefined}>
      <header class="plate-head">
        <p class="plate-no">PLATE I</p>
        <h1>Jefferson County, Texas</h1>
        <p class="plate-sub">The prairie south of Beaumont, {formatDate(snap.time, "long").replace(/^\w+, /, "")}</p>
      </header>

      <div class="figs">
        <MapFigure runtime={runtime} snap={snap} selection={selection} onSelect={onSelect} tool={tool} setTool={setTool} onOpenRig={openRig} />
        <SectionFigure runtime={runtime} snap={snap} line={line} />
      </div>

      <aside class="notes" aria-label="Field notes">
        <FieldNotes runtime={runtime} snap={snap} selection={selection} onSelect={onSelect} onStake={() => setTool("stake")} onOpenRig={openRig} onOpenBooks={openBooks} />
      </aside>

      <footer class="clock">
        <div class="clock-row">
          <div class="when">
            <span data-testid="date">{dateParts(snap.time)}</span>
            <span class="clock-time" data-testid="clock">{formatClock(snap.time)}</span>
          </div>
          <button type="button" class="clock-menu clock-books" data-testid="books" aria-label={`The company's books: ${cashWords(snap)}`} onClick={openBooks}>
            <span class="purse" data-testid="cash">{usd(snap.ops.cash)}</span>
            {snap.ops.debt > 0 && <span class="owe" data-testid="debt">owes {usd(Math.ceil(snap.ops.debt))}</span>}
          </button>
          <button type="button" class="clock-menu" onClick={() => setMenuOpen(true)}>Campaign</button>
        </div>
        <div class="speeds" role="radiogroup" aria-label="Game speed">
          {SPEEDS.map((s) => (
            <button key={s.speed} type="button" role="radio" aria-checked={snap.speed === s.speed} title={s.title} class="speed" data-speed={s.speed} onClick={() => runtime.setSpeed(s.speed)}>
              {s.label}
            </button>
          ))}
        </div>
        <p class="status" role="status" data-testid="status">{snap.status}</p>
      </footer>

      <CampaignMenu runtime={runtime} snap={snap} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <Books runtime={runtime} snap={snap} open={booksOpen} onClose={() => setBooksOpen(false)} />
    </div>
    {showRig && <RigView runtime={runtime} snap={snap} onClose={() => setRigOpen(false)} />}
    </>
  );
}
