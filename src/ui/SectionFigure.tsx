import { useEffect, useRef } from "preact/hooks";
import type { GameRuntime, Snapshot } from "../app/runtime";
import type { SectionLine } from "../sim";
import { drawSection } from "../render/plate/section";
import { devOverlay } from "./devHook";

interface Props {
  runtime: GameRuntime;
  snap: Snapshot;
  line: SectionLine | undefined;
}

export function SectionFigure({ runtime, snap, line }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = wrap.current, cv = canvas.current;
    if (!el || !cv || !line) return;
    const draw = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w < 10 || h < 10) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      const ctx = cv.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const dev = devOverlay();
      drawSection(ctx, w, h, line, snap.knowledge, snap.print, dev ? (c, g) => dev.section(c, g, runtime.currentWorld.seed) : undefined);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [line, snap.rev, snap.knowledge, snap.print, runtime]);

  return (
    <figure class="fig fig-section">
      <div class="section-wrap" ref={wrap}>
        {line ? (
          <canvas ref={canvas} class="section" role="img" data-testid="section" aria-label={`Section along ${line.letter}—${line.letter}′, drawn from the well records the company holds. Blank paper is unknown ground.`} />
        ) : (
          <div class="section-empty">
            <p class="section-empty-title">No line of section yet</p>
            <p>Choose <b>Draw a section</b> and tap two points on the map. The section shows only what the company knows: the surface, and the logs of wells whose owners you have asked. Everything else stays blank paper.</p>
          </div>
        )}
      </div>
      <figcaption><b>FIG. 2.</b> {line ? `Section along ${line.letter}—${line.letter}′: what the company knows beneath the line.` : "A section through the ground, once a line is drawn."}</figcaption>
    </figure>
  );
}
