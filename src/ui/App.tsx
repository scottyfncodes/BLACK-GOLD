import { useEffect, useRef, useState } from "preact/hooks";
import { formatClock, formatDate, type GameRuntime, type Snapshot, type Speed } from "../app/runtime";
import { JEFFERSON_1890 } from "../content/geography/jefferson1890";
import { drawMap } from "../render/map";
import { CampaignMenu } from "./CampaignMenu";

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

export function App({ runtime }: { runtime: GameRuntime }) {
  const snap = useSnapshot(runtime);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (menuOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) {
        if (e.key === " ") return; // let Space press the focused button
      }
      if (e.key === " ") {
        e.preventDefault();
        runtime.togglePause();
        return;
      }
      const match = SPEEDS.find((s) => s.key === e.key);
      if (match) runtime.setSpeed(match.speed);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runtime, menuOpen]);

  return (
    <div class="shell">
      <header class="bar">
        <div class="date" aria-live="off">
          <span class="date-day" data-testid="date">{formatDate(snap.time, "long")}</span>
          <span class="date-clock" data-testid="clock">{formatClock(snap.time)}</span>
        </div>
        <div class="speeds" role="radiogroup" aria-label="Game speed">
          {SPEEDS.map((s) => (
            <button
              key={s.speed}
              type="button"
              role="radio"
              aria-checked={snap.speed === s.speed}
              title={s.title}
              class="speed"
              data-speed={s.speed}
              onClick={() => runtime.setSpeed(s.speed)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      <main class="stage">
        <figure class="map-frame">
          <MapCanvas />
          <figcaption class="map-caption">
            <strong>{JEFFERSON_1890.name}</strong>
            <span>Surface survey only. Nothing is known yet of what lies beneath.</span>
          </figcaption>
        </figure>
      </main>

      <footer class="bar bar-bottom">
        <p class="status" role="status" data-testid="status">
          {snap.status}
        </p>
        <button type="button" class="button" onClick={() => setMenuOpen(true)}>
          Campaign
        </button>
      </footer>

      <CampaignMenu runtime={runtime} snap={snap} open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}

function MapCanvas() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = wrap.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const redraw = () => {
      const size = Math.floor(Math.min(el.clientWidth, el.clientHeight));
      if (size <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      cv.style.width = cv.style.height = `${size}px`;
      cv.width = cv.height = Math.round(size * dpr);
      const ctx = cv.getContext("2d");
      if (ctx) drawMap(ctx, size, dpr, JEFFERSON_1890);
    };
    const ro = new ResizeObserver(redraw);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div class="map-wrap" ref={wrap}>
      <canvas
        ref={canvas}
        class="map"
        role="img"
        aria-label="Map of Jefferson County, Texas in 1890: the Neches River runs south-east past Beaumont to Grigsby's Bluff, the Texas and New Orleans Railroad crosses east to west through Beaumont, and coastal marsh covers the south."
      />
    </div>
  );
}
