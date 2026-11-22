import { render } from "preact";
import { GameRuntime } from "./app/runtime";
import { App } from "./ui/App";
import "./ui/styles.css";

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
