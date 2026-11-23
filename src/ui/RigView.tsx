import { useEffect, useRef, useState } from "preact/hooks";
import { formatClock, formatDate, type GameRuntime, type Snapshot, type Speed } from "../app/runtime";
import { CAP_COST, COSTS, HAUL_LIMIT_BBL, SWEET_FT, MINUTES_PER_DAY, type SampleEvidence } from "../sim";
import { drawScene, SceneState } from "../render/rig/scene";
import { RigAudio } from "./rigAudio";

interface Props {
  runtime: GameRuntime;
  snap: Snapshot;
  onClose: () => void;
}

const STROKES_PER_SECOND = 0.85;
const OPS: Record<string, string> = { rigup: "Raising the derrick", bail: "Bailing the hole", dress: "Dressing the bit at the forge", case: "Running casing", fish: "Fishing for the tools" };

export function RigView({ runtime, snap, onClose }: Props) {
  const well = snap.ops.well;
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const trace = useRef<HTMLCanvasElement>(null);
  const audio = useRef(new RigAudio());
  const [muted, setMuted] = useState(false);
  const latest = useRef(snap);
  latest.current = snap;

  // Time runs at rig pace while this view is open.
  useEffect(() => {
    runtime.setAtRig(true);
    return () => { runtime.setAtRig(false); audio.current.stop(); };
  }, [runtime]);

  // The animated plate and the line-tension trace.
  useEffect(() => {
    const el = stage.current!, cv = canvas.current!;
    const scene = new SceneState();
    const tension: number[] = [];
    let raf = 0, last = performance.now(), anim = 0, stroke = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      anim += dt;
      const s = latest.current, w = s.ops.well;
      if (!w) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = el.clientWidth, ch = el.clientHeight;
      if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
        cv.width = Math.round(cw * dpr);
        cv.height = Math.round(ch * dpr);
        cv.style.width = `${cw}px`;
        cv.style.height = `${ch}px`;
      }
      const working = w.status === "drilling" && !w.busy && s.speed !== "paused";
      const prev = stroke;
      if (working) stroke = (stroke + dt * STROKES_PER_SECOND) % 1;
      // A blow lands at the bottom of each stroke.
      if (working && prev < 0.5 && stroke >= 0.5) {
        const slack = w.reachFt - w.depthFt;
        audio.current.blow(w.contact, slack > SWEET_FT);
        audio.current.chuff();
      }
      audio.current.roar(w.status === "gusher");
      const ctx = cv.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const samples = s.knowledge.evidence.filter((e): e is SampleEvidence => e.kind === "sample");
      drawScene(ctx, scene, { w: cw, h: ch, anim, gameTime: s.time, well: w, samples, stroke }, dt);

      // Line tension: a crisp sawtooth when the tools strike squarely, mush when slack, flat when short.
      const slack = w.reachFt - w.depthFt;
      const phase = Math.sin(stroke * Math.PI * 2);
      tension.push(working ? (phase > 0 ? phase : phase * 0.3) * (0.25 + 0.75 * w.contact) * (slack > SWEET_FT ? 0.45 : 1) : 0);
      if (tension.length > 160) tension.shift();
      const tr = trace.current;
      if (!tr) return;
      const tw = tr.clientWidth, th = tr.clientHeight;
      if (tr.width !== Math.round(tw * dpr)) { tr.width = Math.round(tw * dpr); tr.height = Math.round(th * dpr); }
      const t = tr.getContext("2d")!;
      t.setTransform(dpr, 0, 0, dpr, 0, 0);
      t.clearRect(0, 0, tw, th);
      t.strokeStyle = "rgba(42,33,24,0.25)";
      t.beginPath(); t.moveTo(0, th * 0.7); t.lineTo(tw, th * 0.7); t.stroke();
      t.strokeStyle = w.contact > 0.85 ? "#2a2118" : "#a3302a";
      t.lineWidth = 1.5;
      t.beginPath();
      tension.forEach((v, i) => { const x = (i / 160) * tw, y = th * 0.7 - v * th * 0.6; if (i) t.lineTo(x, y); else t.moveTo(x, y); });
      t.stroke();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const act = (type: string, payload: Record<string, unknown> = {}) => () => { audio.current.start(); runtime.command(type, payload as never); };
  const feed = (on: boolean) => {
    audio.current.start();
    const w = latest.current.ops.well;
    if (on && latest.current.speed === "paused" && w?.status === "drilling") runtime.setSpeed("1x");
    if (w) runtime.command("rig.feed", { on });
  };

  // Hold Space to feed; B, D, C, A for the operations; Escape for the map.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === " " && !e.repeat) { e.preventDefault(); feed(true); }
      if (e.key === " ") e.preventDefault();
      if (e.key === "b") act("rig.bail")();
      if (e.key === "d") act("rig.dress")();
      if (e.key === "c") act("rig.case")();
      const w = latest.current.ops.well;
      if (!w) return;
      if (e.key === "a") act("rig.auto", { on: !w.auto })();
      if (e.key === "Escape") onClose();
    };
    const up = (e: KeyboardEvent) => { if (e.key === " ") { e.preventDefault(); feed(false); } };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); };
  });

  if (!well) return null;
  const capped = snap.ops.production.producers.some((p) => p.wellId === well.id);
  const slack = well.reachFt - well.depthFt;
  const needle = Math.max(-1, Math.min(1, slack < 0 ? slack / 1.5 - 0.3 : slack <= SWEET_FT ? -0.3 + (slack / SWEET_FT) * 0.6 : 0.3 + (slack - SWEET_FT) / 6));
  const lineWord = slack < 0 ? "Tools short of bottom" : slack <= SWEET_FT ? "Striking square" : "Slack in the line";
  const days = Math.floor((snap.time - well.spudAt) / MINUTES_PER_DAY);
  const done = well.status === "gusher" || well.status === "dry";
  const caseCost = Math.ceil(Math.max(0, well.depthFt - well.casedFt) * COSTS.casingPerFt);
  const busy = well.busy ? OPS[well.busy.op] : null;
  const speeds: [Speed, string][] = [["paused", "Pause"], ["1x", "1×"], ["4x", "4×"], ["16x", "16×"]];

  return (
    <div class="rig" role="dialog" aria-label={`The rig: ${well.name}`}>
      <div class="rig-stage" ref={stage}>
        <canvas ref={canvas} role="img" data-testid="rig-scene" aria-label={`${well.name}, ${Math.floor(well.depthFt)} feet. ${busy ?? (well.status === "drilling" ? lineWord : well.status)}.`} />
      </div>

      <header class="rig-top">
        <button type="button" class="rig-back" onClick={onClose}>← Map</button>
        <div class="rig-title">
          <h2>{well.name}</h2>
          <p data-testid="rig-status">{done ? well.outcome : busy ? `${busy}…` : well.status === "stuck" ? "The tools are stuck." : well.auto ? "The driller is running the tools." : "Hold Feed to let out line. Keep the needle in the band."}</p>
        </div>
        <button type="button" class="rig-back" aria-pressed={muted} onClick={() => { setMuted(!muted); audio.current.setMuted(!muted); }}>{muted ? "Sound off" : "Sound on"}</button>
      </header>

      <aside class="rig-gauges" aria-label="Rig gauges">
        <div class="gauge gauge-depth"><span>Depth</span><b data-testid="rig-depth">{Math.floor(well.depthFt)}</b><i>feet</i></div>
        <div class="gauge"><span>Cuttings</span><div class={`bar ${well.fillFt > 5.5 ? "warn" : ""}`}><div style={{ width: `${Math.min(100, (well.fillFt / 10) * 100)}%` }} /></div><i>{well.fillFt > 5.5 ? "bail the hole" : `${well.fillFt.toFixed(1)} ft in the hole`}</i></div>
        <div class="gauge"><span>Bit</span><div class={`bar ${well.sharp < 0.4 ? "warn" : ""}`}><div style={{ width: `${well.sharp * 100}%` }} /></div><i>{well.sharp < 0.4 ? "blunt: dress it" : "sharp enough"}</i></div>
        <div class="gauge"><span>Open sand</span><div class={`bar ${well.openSandFt > 80 ? "warn" : ""}`}><div style={{ width: `${Math.min(100, well.openSandFt / 1.5)}%` }} /></div><i>{well.openSandFt > 80 ? "may cave: set casing" : `cased to ${Math.floor(well.casedFt)} ft`}</i></div>
        <div class="gauge gauge-money"><span>Funds</span><b data-testid="rig-cash">${Math.floor(snap.ops.cash)}</b><i>day {days} · {formatDate(snap.time)} {formatClock(snap.time)}</i></div>
      </aside>

      {!done && (
        <footer class="rig-controls">
          {well.status === "stuck" && !well.busy ? (
            <div class="rig-row">
              <button type="button" class="button button-primary" onClick={act("rig.fish")}>Fishing job<small>8 hours · ${COSTS.fishing}</small></button>
              <button type="button" class="button" onClick={act("rig.abandon")}>Abandon the hole</button>
            </div>
          ) : (
            <>
              <div class="feel" aria-live="polite">
                <div class="dial" aria-hidden="true"><div class="band" /><div class="needle" style={{ transform: `rotate(${needle * 70}deg)` }} /></div>
                <div class="feel-text"><b class={slack < 0 || slack > SWEET_FT ? "red" : ""}>{well.status === "drilling" && !busy ? lineWord : busy ?? "Waiting"}</b><canvas ref={trace} class="trace" aria-hidden="true" /></div>
              </div>
              <button
                type="button"
                class="feed"
                data-testid="feed"
                aria-pressed={well.feeding}
                disabled={!!busy || well.auto || well.status !== "drilling"}
                onPointerDown={(e) => {
                  // Keep the press even if the finger slides off; capture is best-effort.
                  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not capturable */ }
                  feed(true);
                }}
                onPointerUp={() => feed(false)}
                onPointerCancel={() => feed(false)}
                onContextMenu={(e) => e.preventDefault()}
              >
                Feed the line<small>hold · Space</small>
              </button>
              <div class="rig-row">
                <button type="button" class="button" disabled={!!busy || well.status !== "drilling"} onClick={act("rig.bail")}>Bail<small>B · sample</small></button>
                <button type="button" class="button" disabled={!!busy || well.status !== "drilling"} onClick={act("rig.dress")}>Dress bit<small>D</small></button>
                <button type="button" class="button" disabled={!!busy || well.status !== "drilling" || caseCost < 22} onClick={act("rig.case")}>Set casing<small>${caseCost}</small></button>
                <button type="button" class="button" aria-pressed={well.auto} disabled={well.status !== "drilling"} onClick={act("rig.auto", { on: !well.auto })}>{well.auto ? "Take the controls" : "Let the driller"}<small>A</small></button>
              </div>
              <div class="rig-speeds" role="radiogroup" aria-label="Rig speed">
                {speeds.map(([sp, label]) => (
                  <button key={sp} type="button" role="radio" aria-checked={snap.speed === sp} onClick={() => runtime.setSpeed(sp)}>{label}</button>
                ))}
              </div>
            </>
          )}
        </footer>
      )}

      {done && (
        <div class={`result ${well.status}`} role="status" data-testid="rig-result">
          <p class="result-word">{well.status === "gusher" ? (well.outcome?.startsWith("GAS") ? "Gas." : "Oil.") : "Dry hole."}</p>
          <p>{well.outcome}</p>
          <p class="result-meta">{Math.floor(well.depthFt)} ft in {days} days · ${Math.floor(snap.ops.cash)} left</p>
          {well.status === "gusher" && well.outcome?.startsWith("OIL") && !capped && (
            <button type="button" class="button button-primary" data-testid="cap" disabled={snap.ops.cash < CAP_COST} onClick={act("prod.cap")}>
              Cap it and sell the oil<small>${CAP_COST} · up to {HAUL_LIMIT_BBL} bbl a day by wagon</small>
            </button>
          )}
          {capped && <p class="result-meta" data-testid="capped">Capped. Teamsters haul the oil to Beaumont; it is sold at the month's end.</p>}
          {well.status === "gusher" && well.outcome?.startsWith("GAS") && <p class="result-meta">Gas has no buyer in 1890. Look for oil below or nearby.</p>}
          <button type="button" class={`button ${capped || well.status !== "gusher" || !well.outcome?.startsWith("OIL") ? "button-primary" : ""}`} onClick={onClose}>Back to the map</button>
        </div>
      )}
    </div>
  );
}
