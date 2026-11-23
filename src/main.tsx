import { render } from "preact";
import { GameRuntime } from "./app/runtime";
import { setCanvasFactory } from "./render/plate/paper";
import { App } from "./ui/App";
import "./ui/styles.css";

setCanvasFactory((w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
});

// Development only: the god view of hidden geology. Never part of a production build.
if (import.meta.env.DEV) void import("./debug/godview");

const runtime = new GameRuntime();

let last = performance.now();
function frame(now: number) {
  runtime.tick(now - last);
  last = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame((now) => {
  last = now;
  requestAnimationFrame(frame);
});

render(<App runtime={runtime} />, document.getElementById("app")!);
void runtime.boot();

// Exposed for end-to-end tests and debugging. Read-only by convention.
(window as unknown as { blackGold: GameRuntime }).blackGold = runtime;
