import { expect, test, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { CAMPAIGN_START, gameEngine, MINUTES_PER_DAY, operationsOf, printedMap, type WorldState } from "../../src/sim";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";
import { createSave, encodeSave } from "../../src/app/save/format";

/**
 * Driven casing through quicksand, by the UI on phone and desktop: the bailer's evidence and the
 * drive offer, the drive head, the driving panel and its log, the call of refusal, setting the
 * pipe, the casing sheet, and a collapsed string's swaging job. Saves are made by the sim at the
 * point to look at (the review's world, where running sand starts at about 190 ft).
 */
const SEED = "e459b94df4abf2ce";
type Snap = { speed: string; ops: { well: { status: string; drive: { refused: boolean } | null; strings: { method?: string }[] } | null; tools: { driveHead: boolean } } };
type Runtime = { snapshot(): Snap; setSpeed(s: string): void };
const rt = <T,>(page: Page, fn: (g: Runtime) => T) => page.evaluate((f) => new Function("g", `return (${f})(g)`)((window as unknown as { blackGold: Runtime }).blackGold), fn.toString()) as Promise<Awaited<T>>;
const snap = (page: Page) => rt(page, (g) => g.snapshot());
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });

/** A hole on running sand, drilled until the bailer shows sand coming back; the player has the controls. */
function sandBack(): WorldState {
  const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
  const hill = printedMap(SEED).hills[0]!;
  const at = { x: hill.x - 0.15, y: hill.y - 0.1 };
  cmd(w, "lease.take", { surveyId: SURVEYS.find((s) => insidePoly(s.poly, at.x, at.y))!.id, offer: "asking" });
  cmd(w, "rig.spud", at);
  gameEngine.advance(w, w.time + 3 * MINUTES_PER_DAY + 10);
  cmd(w, "rig.auto", { on: true });
  for (let k = 0; k < 2000 && (operationsOf(w).well!.lastInflow ?? 0) < 1.5; k++) {
    gameEngine.advance(w, w.time + 30, { stopOnInterrupt: true });
    const p = operationsOf(w).crew.pending;
    if (p) cmd(w, "crew.decline", { id: p.id });
    if (operationsOf(w).well!.status === "stuck" && !operationsOf(w).well!.busy) cmd(w, "rig.fish");
  }
  cmd(w, "rig.auto", { on: false });
  for (let k = 0; k < 20 && operationsOf(w).well!.busy; k++) gameEngine.advance(w, operationsOf(w).well!.busy!.until + 6);
  return w;
}

async function load(page: Page, w: WorldState) {
  await page.goto("/");
  await expect(page.getByTestId("date")).toBeVisible();
  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "quicksand.blackgold", mimeType: "application/gzip", buffer: gzipSync(Buffer.from(encodeSave(createSave(w, "e2e", "2026-11-25T00:00:00Z")))) });
  await expect(page.getByTestId("status")).toContainText("Imported");
  await page.keyboard.press("Escape");
  await page.getByTestId("to-rig").click();
  return page.getByRole("dialog", { name: /The rig/ });
}

async function fits(page: Page, ids: string[]) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
  for (const id of ids) {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(b.height, id).toBeGreaterThanOrEqual(44);
    expect(b.x + b.width, id).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
}

test("sand coming back: drive the pipe, watch it go down, take the call of refusal and set it", async ({ page }) => {
  test.setTimeout(90_000);
  const rig = await load(page, sandBack());
  // The offer follows the bailer's evidence, with its price; the drive head is bought with it.
  const offer = rig.getByTestId("drive-start");
  await expect(offer).toContainText("Drive the 10-inch instead");
  await expect(offer).toContainText("with a drive head ($40)");
  await fits(page, ["drive-start", "driller"]);
  await offer.click();
  await expect.poll(async () => (await snap(page)).ops.tools.driveHead).toBe(true);
  // Skip runs until the driller calls refusal: the clock stops for the player's decision.
  await rt(page, (g) => g.setSpeed("skip"));
  await expect.poll(async () => (await snap(page)).ops.well!.drive?.refused ?? false, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await snap(page)).speed, { timeout: 10_000 }).toBe("paused");
  const panel = rig.getByTestId("drive-panel");
  await expect(panel).toContainText("Driving the 10-inch");
  await expect(panel).toContainText("He calls it refusal.");
  await expect(panel).not.toContainText(/%|chance/);
  await expect(rig.getByTestId("rig-status")).toContainText("Set it here, or drive on.");
  await expect(rig.getByTestId("drive-on")).toBeEnabled();
  await fits(page, ["set-drive", "drive-on", "driller"]);
  await rig.getByTestId("set-drive").click();
  await expect.poll(async () => (await snap(page)).ops.well!.strings[0]?.method).toBe("driven");
  await rig.getByTestId("casing-open").click();
  const sheet = page.getByTestId("casing-sheet");
  await expect(sheet).toContainText(/Driven, \d+ ft of it under the maul\./);
  await expect(sheet).toContainText("The company has them.");
  await sheet.getByRole("button", { name: "Close" }).click();
});

test("a collapsed string: a swaging job, dear and without promise, or abandon the hole", async ({ page }) => {
  const w = sandBack();
  const o = w.systems.operations as unknown as { well: Record<string, unknown> & { strings: unknown[]; depthFt: number }; tools: { driveHead: boolean } };
  o.tools.driveHead = true;
  o.well.strings.push({ size: 0, seatFt: Math.round(o.well.depthFt), costCents: 20_000, setAt: w.time, seatCall: null, observed: "sand", pulled: false, method: "driven", drivenFt: 60, damage: "collapsed" });
  o.well.status = "stuck";
  o.well.collapse = { atFt: Math.round(o.well.depthFt) - 20, attempts: 0 };
  const rig = await load(page, w);
  await expect(rig.getByTestId("rig-status")).toContainText("has collapsed at about");
  await expect(rig.getByTestId("swage")).toContainText("no promise");
  await expect(rig.getByTestId("swage")).toContainText("$150");
  await fits(page, ["swage"]);
  await rig.getByRole("button", { name: "Abandon the hole" }).click();
  await expect.poll(async () => (await snap(page)).ops.well!.status).toBe("dry");
});
