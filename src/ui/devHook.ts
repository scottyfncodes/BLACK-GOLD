import type { MapView } from "../render/plate/map";
import type { SectionGeometry } from "../render/plate/section";

/**
 * Development only: the god view registers itself here (src/debug/godview.ts, loaded by
 * main.tsx only when import.meta.env.DEV). Production builds never load it, so this returns
 * undefined and nothing about the truth can be drawn.
 */
export interface DevOverlay {
  map(ctx: CanvasRenderingContext2D, v: MapView, seed: string): void;
  section(ctx: CanvasRenderingContext2D, g: SectionGeometry, seed: string): void;
}

export function devOverlay(): DevOverlay | undefined {
  if (!import.meta.env.DEV) return undefined;
  const hook = (globalThis as { __blackGoldGodView?: { on: boolean; overlay: DevOverlay } }).__blackGoldGodView;
  return hook?.on ? hook.overlay : undefined;
}
