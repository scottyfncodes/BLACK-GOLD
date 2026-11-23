import { useEffect, useRef, useState } from "preact/hooks";
import type { GameRuntime, Snapshot } from "../app/runtime";
import { SURVEYS } from "../content/geography/surveys";
import { JEFFERSON_1890, regionSizeKm } from "../content/geography/jefferson1890";
import { drawManuscript, drawPrint, FIELD_SCALE, hitTest, toKm, type MapView, type Selection } from "../render/plate/map";
import { drawLife } from "../render/plate/life";
import type { Pt } from "../render/plate/kit";
import { devOverlay } from "./devHook";

export type Tool = "select" | "section" | "prospect" | "stake";

interface Props {
  runtime: GameRuntime;
  snap: Snapshot;
  selection: Selection;
  onSelect: (s: Selection) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  onOpenRig: () => void;
}

const REGION = regionSizeKm(JEFFERSON_1890);
const SURVEYED = (() => {
  const xs = SURVEYS.flatMap((s) => s.poly.map((p) => p[0])), ys = SURVEYS.flatMap((s) => s.poly.map((p) => p[1]));
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
})();
const MAX_SCALE = 140;

interface Cache { canvas: HTMLCanvasElement; view: MapView; dpr: number; print: unknown }

export function MapFigure({ runtime, snap, selection, onSelect, tool, setTool, onOpenRig }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [draft, setDraft] = useState<Pt | null>(null);
  const view = useRef<MapView | null>(null);
  const cache = useRef<Cache | null>(null);
  const dirty = useRef(true);
  const settle = useRef<number | undefined>(undefined);
  const latest = useRef({ snap, selection, draft, tool, setTool, onOpenRig });
  latest.current = { snap, selection, draft, tool, setTool, onOpenRig };

  const minScale = () => { const v = view.current!; return Math.min(v.w / REGION.width, v.h / REGION.height) * 0.98; };
  const clampView = () => {
    const v = view.current!;
    v.scale = Math.max(minScale(), Math.min(MAX_SCALE, v.scale));
    const hw = v.w / 2 / v.scale, hh = v.h / 2 / v.scale;
    v.cx = hw * 2 >= REGION.width ? REGION.width / 2 : Math.max(hw, Math.min(REGION.width - hw, v.cx));
    v.cy = hh * 2 >= REGION.height ? REGION.height / 2 : Math.max(hh, Math.min(REGION.height - hh, v.cy));
  };

  const rebuildPrint = () => {
    const v = view.current, cv = canvas.current;
    if (!v || !cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = cache.current?.canvas ?? document.createElement("canvas");
    c.width = Math.round(v.w * dpr);
    c.height = Math.round(v.h * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPrint(ctx, v, latest.current.snap.print);
    cache.current = { canvas: c, view: { ...v }, dpr, print: latest.current.snap.print };
    // For end-to-end tests: where the map is looking, so a test can tap a known place.
    cv.dataset.view = `${v.cx.toFixed(4)},${v.cy.toFixed(4)},${v.scale.toFixed(4)}`;
    dirty.current = true;
  };
  const scheduleSettle = () => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(rebuildPrint, 160);
  };

  // Size, first view and redraw loop.
  useEffect(() => {
    const el = wrap.current!, cv = canvas.current!;
    let raf = 0;
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w < 10 || h < 10) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      if (!view.current) {
        const sx = SURVEYED.x1 - SURVEYED.x0, sy = SURVEYED.y1 - SURVEYED.y0;
        // Open on the surveyed prairie at field scale, where names and notes are legible.
        view.current = { w, h, cx: (SURVEYED.x0 + SURVEYED.x1) / 2, cy: (SURVEYED.y0 + SURVEYED.y1) / 2, scale: Math.max(FIELD_SCALE + 4, Math.min(w / (sx * 1.04), h / (sy * 1.04))) };
      } else Object.assign(view.current, { w, h });
      clampView();
      rebuildPrint();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const started = performance.now();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      // The plate is alive (smoke, the train, the party, daylight), so it redraws every frame.
      if (!view.current || !cache.current) return;
      dirty.current = false;
      const v = view.current, c = cache.current, dpr = Math.min(window.devicePixelRatio || 1, 2);
      const ctx = cv.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      // Composite the cached print layer under the current view (pan and zoom without a redraw).
      const k = v.scale / c.view.scale;
      const dx = (c.view.cx - v.cx) * v.scale + (v.w / 2) - (c.view.w / 2) * k;
      const dy = (c.view.cy - v.cy) * v.scale + (v.h / 2) - (c.view.h / 2) * k;
      ctx.fillStyle = "#ebdfc4";
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(c.canvas, dx * dpr, dy * dpr, c.view.w * k * dpr, c.view.h * k * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const { snap: s, selection: sel, draft: d } = latest.current;
      drawManuscript(ctx, v, { knowledge: s.knowledge, print: s.print, selection: sel, draft: d });
      drawLife(ctx, v, { anim: (performance.now() - started) / 1000, gameTime: s.time, knowledge: s.knowledge, wells: s.ops.well ? [...s.ops.past, s.ops.well] : s.ops.past });
      devOverlay()?.map(ctx, v, runtime.currentWorld.seed);
    };
    raf = requestAnimationFrame(frame);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); window.clearTimeout(settle.current); };
  }, [runtime]);

  // A new world (new campaign, load) means a new printed map.
  useEffect(() => { if (cache.current && cache.current.print !== snap.print) rebuildPrint(); dirty.current = true; }, [snap.print, snap.rev, selection, draft]);

  // Gestures: drag to pan, pinch or wheel to zoom, tap to act.
  useEffect(() => {
    const cv = canvas.current!;
    const pts = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number; t: number; moved: boolean } | null = null;
    let pinch: { d: number; scale: number } | null = null;
    const local = (e: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const zoomAt = (px: number, py: number, factor: number) => {
      const v = view.current!;
      const [kx, ky] = toKm(v)(px, py);
      v.scale *= factor;
      clampView();
      const [nx, ny] = toKm(v)(px, py);
      v.cx += kx - nx;
      v.cy += ky - ny;
      clampView();
      dirty.current = true;
      scheduleSettle();
    };
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, local(e));
      if (pts.size === 1) start = { ...local(e), t: performance.now(), moved: false };
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale: view.current!.scale };
        if (start) start.moved = true;
      }
    };
    const move = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId);
      if (!prev || !view.current) return;
      const p = local(e);
      pts.set(e.pointerId, p);
      const v = view.current;
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        zoomAt((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, (pinch.scale * (d / pinch.d)) / v.scale);
        return;
      }
      if (start && Math.hypot(p.x - start.x, p.y - start.y) > 6) start.moved = true;
      if (start?.moved) {
        v.cx -= (p.x - prev.x) / v.scale;
        v.cy -= (p.y - prev.y) / v.scale;
        clampView();
        dirty.current = true;
        scheduleSettle();
      }
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0 && start && !start.moved && performance.now() - start.t < 600) tap(start.x, start.y);
      if (pts.size === 0) start = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    };
    const tap = (px: number, py: number) => {
      const v = view.current!;
      const { snap: s, tool: t, draft: d } = latest.current;
      const km = toKm(v)(px, py);
      if (t === "section") {
        if (!d) { setDraft(km); return; }
        const reason = runtime.command("interp.section.add", { a: d, b: km });
        setDraft(null);
        latest.current.setTool("select");
        if (!reason) { const secs = runtime.snapshot().knowledge.interp.sections; onSelect({ kind: "section", id: secs[secs.length - 1]!.id }); }
        return;
      }
      if (t === "stake") {
        const reason = runtime.command("rig.spud", { x: km[0], y: km[1] });
        latest.current.setTool("select");
        if (!reason) latest.current.onOpenRig();
        return;
      }
      if (t === "prospect") {
        const reason = runtime.command("interp.prospect.add", { at: km, r: 0.8 });
        latest.current.setTool("select");
        if (!reason) { const ps = runtime.snapshot().knowledge.interp.prospects; onSelect({ kind: "prospect", id: ps[ps.length - 1]!.id }); }
        return;
      }
      onSelect(hitTest(v, { knowledge: s.knowledge, print: s.print, selection: null, draft: null }, px, py));
    };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      cv.removeEventListener("wheel", wheel);
    };
  }, [runtime, onSelect]);

  const zoomButton = (f: number) => () => {
    const v = view.current;
    if (!v) return;
    const c = [v.w / 2, v.h / 2];
    const [kx, ky] = toKm(v)(c[0]!, c[1]!);
    v.scale *= f;
    clampView();
    v.cx = kx; v.cy = ky;
    clampView();
    dirty.current = true;
    scheduleSettle();
  };
  const hint = tool === "section" ? (draft ? "Tap where the line should end." : "Tap where the line of section should begin.") : tool === "prospect" ? "Tap the centre of your prospect." : tool === "stake" ? "Tap where the derrick should stand." : null;

  return (
    <figure class="fig fig-map">
      <div class="map-tools" role="toolbar" aria-label="Map tools">
        <button type="button" class="tool" aria-pressed={tool === "section"} onClick={() => { setDraft(null); setTool(tool === "section" ? "select" : "section"); }}>Draw section</button>
        <button type="button" class="tool" aria-pressed={tool === "prospect"} onClick={() => { setDraft(null); setTool(tool === "prospect" ? "select" : "prospect"); }}>Mark prospect</button>
        <span class="tool-gap" />
        <button type="button" class="tool tool-sq" aria-label="Zoom out" onClick={zoomButton(1 / 1.5)}>−</button>
        <button type="button" class="tool tool-sq" aria-label="Zoom in" onClick={zoomButton(1.5)}>+</button>
      </div>
      <div class="map-wrap" ref={wrap}>
        <canvas
          ref={canvas}
          class="map"
          role="img"
          data-testid="map"
          aria-label={`Map of ${JEFFERSON_1890.name}, 1890: the published survey with the company's notes in red. ${snap.knowledge.evidence.length} notes recorded.`}
        />
        {hint && <p class="map-hint" role="status">{hint}</p>}
      </div>
      <figcaption><b>FIG. 1.</b> The prairie south of Beaumont. Print is the county survey; red is the company's own hand.</figcaption>
    </figure>
  );
}
