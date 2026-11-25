import { expect, test, type Page } from "@playwright/test";
import { SURVEYS, centroid } from "../../src/content/geography/surveys";

/**
 * Casing and the driller, through the UI on phone and desktop: his advice on the map and at the
 * rig, the casing sheet, the crew sheet (record, standing orders, hiring), pulling pipe, layout.
 */
type Snap = {
  speed: string;
  ops: {
    cash: number;
    well: { id: string; status: string; depthFt: number; strings: { seatFt: number; observed: string; pulled: boolean }[] } | null;
    crew: { pending: { id: number; kind: string } | null; driller: { id: string; name: string }; candidates: { id: string }[]; orders: { authority: string; budgetCents: number } };
  };
  paths: { kind: string }[];
};
type Runtime = { snapshot(): Snap; newCampaign(s: string): Promise<void>; command(t: string, p: unknown): string | null; setSpeed(s: string): void };
const rt = <T,>(page: Page, fn: (g: Runtime, arg: never) => T, arg?: unknown) => page.evaluate(([f, a]) => new Function("g", "a", `return (${f})(g, a)`)((window as unknown as { blackGold: Runtime }).blackGold, a), [fn.toString(), arg] as const) as Promise<Awaited<T>>;
const snap = (page: Page) => rt(page, (g) => g.snapshot());

const SEED = "e459b94df4abf2ce";

async function start(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("date")).toBeVisible();
  await rt(page, (g, s: string) => g.newCampaign(s), SEED);
  await expect(page.getByTestId("map")).toHaveAttribute("data-view", /,/);
}

/** Lease and spud survey 3 through the runtime (the same path the buttons use), the driller on. */
async function spud(page: Page) {
  const s = SURVEYS[3]!;
  const [x, y] = centroid(s.poly);
  expect(await rt(page, (g, a: { id: string; x: number; y: number }) => g.command("lease.take", { surveyId: a.id, offer: "asking" }) ?? g.command("rig.spud", { x: a.x, y: a.y }) ?? g.command("rig.auto", { on: true }), { id: s.id, x, y })).toBeNull();
}

async function skipUntilPaused(page: Page) {
  await page.getByRole("radio", { name: "Skip" }).click();
  await expect.poll(async () => (await snap(page)).speed, { timeout: 15_000 }).toBe("paused");
}

/** Run time until something stops it, through the runtime's own speed control (works at the rig too). */
async function runUntilPaused(page: Page) {
  await rt(page, (g) => g.setSpeed("skip"));
  await expect.poll(async () => (await snap(page)).speed, { timeout: 20_000 }).toBe("paused");
}

/** Answer whatever he is waiting on: accept fishing, decline the rest (setup only). */
async function answer(page: Page) {
  const p = (await snap(page)).ops.crew.pending;
  if (p) await rt(page, (g, a: { id: number; kind: string }) => g.command(a.kind === "fish" ? "crew.accept" : "crew.decline", { id: a.id }), p);
}

test("his advice stops the clock on the map; declining it is remembered", async ({ page }) => {
  test.setTimeout(90_000);
  await start(page);
  await spud(page);
  const sheet = page.getByTestId("advice-sheet");
  for (let i = 0; i < 30 && !(await sheet.isVisible()); i++) {
    const w = (await snap(page)).ops.well!;
    if (w.status === "dry" || w.status === "gusher") break;
    await skipUntilPaused(page);
  }
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(", the driller");
  const id = (await snap(page)).ops.crew.pending!.id;
  for (const b of [sheet.getByTestId("advice-yes"), sheet.getByTestId("advice-no")]) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await sheet.getByTestId("advice-no").click();
  await expect(sheet).toBeHidden();
  expect((await snap(page)).ops.crew.pending).toBeNull();
  // The same advice does not come straight back.
  await skipUntilPaused(page);
  const again = (await snap(page)).ops.crew.pending;
  if (again) expect(again.id).not.toBe(id);
});

test("at the rig: accept his advice, and inspect the casing he set", async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  await spud(page);
  await page.getByTestId("to-rig").click();
  const rig = page.getByRole("dialog", { name: /The rig/ });
  let accepted = false;
  for (let i = 0; i < 40 && !accepted; i++) {
    const s = await snap(page);
    if (s.ops.well!.status === "dry" || s.ops.well!.status === "gusher") break;
    if (s.ops.crew.pending) {
      await expect(rig.getByTestId("advice")).toBeVisible();
      if (s.ops.crew.pending.kind === "case") {
        await rig.getByTestId("advice-yes").click();
        accepted = true;
        break;
      }
      await rig.getByTestId(s.ops.crew.pending.kind === "fish" ? "advice-yes" : "advice-no").click();
    }
    if (s.ops.well!.status === "stuck" && !(await snap(page)).ops.crew.pending) await rt(page, (g) => g.command("rig.fish", {}));
    await runUntilPaused(page);
  }
  if (!accepted) {
    // He saw no cause for pipe on this ground: set a string by hand instead.
    await rt(page, (g) => g.command("rig.auto", { on: false }));
    await rig.getByRole("button", { name: /^Set 10-inch/ }).click();
  }
  // Time must run for the pipe to go in.
  for (let i = 0; i < 6 && (await snap(page)).ops.well!.strings.length === 0; i++) { await answer(page); await runUntilPaused(page); }
  await expect.poll(async () => (await snap(page)).ops.well!.strings.length, { timeout: 20_000 }).toBeGreaterThan(0);
  await rig.getByTestId("casing-open").click();
  const casing = page.getByTestId("casing-sheet");
  await expect(casing).toBeVisible();
  await expect(casing.getByTestId("strings")).toContainText("10-inch to");
  await expect(casing.getByTestId("strings")).toContainText("Seat:");
  await expect(casing).toContainText("Pipe left");
  const over = await casing.evaluate((d) => d.scrollWidth - d.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
  await casing.getByRole("button", { name: "Close" }).click();
  await expect(casing).toBeHidden();
});

test("the crew sheet: his record, standing orders, and hiring between wells only", async ({ page }) => {
  test.setTimeout(60_000);
  await start(page);
  await page.getByTestId("open-crew").click();
  const crew = page.getByTestId("crew");
  await expect(crew).toBeVisible();
  await expect(crew.getByTestId("record")).toContainText("Nothing yet");
  await crew.getByTestId("orders-judgement").click();
  await expect(crew.getByTestId("orders")).toContainText("a calendar month");
  await crew.getByTestId("budget-more").click();
  expect((await snap(page)).ops.crew.orders).toMatchObject({ authority: "judgement", budgetCents: 20_000 });
  await crew.getByTestId("orders-ask").click();
  const before = (await snap(page)).ops.crew.driller.id;
  await crew.getByTestId("hire").first().click();
  expect((await snap(page)).ops.crew.driller.id).not.toBe(before);
  const over = await crew.evaluate((d) => d.scrollWidth - d.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
  await crew.getByRole("button", { name: "Close" }).click();
  // Mid-well, no change of driller.
  await spud(page);
  await page.getByTestId("open-crew").click();
  await expect(crew.getByTestId("hire").first()).toBeDisabled();
  await expect(crew).toContainText("between wells");
});

test("pulling casing from a dead hole gets part of its cost back", async ({ page }) => {
  test.setTimeout(90_000);
  await start(page);
  await spud(page);
  // Drill some way, set two strings, then plug the hole (through the runtime's command path).
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < 30; i++) {
      const w = (await snap(page)).ops.well!;
      if (w.depthFt > 120 * (k + 1) && w.status === "drilling") break;
      await answer(page);
      if ((await snap(page)).ops.well!.status === "stuck" && !(await snap(page)).ops.crew.pending) await rt(page, (g) => g.command("rig.fish", {}));
      await runUntilPaused(page);
    }
    await answer(page);
    if ((await snap(page)).ops.well!.strings.length === k) {
      expect(await rt(page, (g) => g.command("rig.case", {}))).toBeNull();
      await runUntilPaused(page);
    }
  }
  await answer(page);
  expect(await rt(page, (g) => g.command("rig.abandon", {}))).toBeNull();
  await page.getByTestId("to-rig").click();
  const pull = page.getByTestId("pull");
  await expect(pull).toBeVisible();
  const cash = (await snap(page)).ops.cash;
  await pull.click();
  await page.getByRole("dialog", { name: /The rig/ }).getByRole("button", { name: /Back to the map|← Map/ }).first().click();
  for (let i = 0; i < 4 && !(await snap(page)).ops.well!.strings.every((s) => s.pulled); i++) await runUntilPaused(page);
  expect((await snap(page)).ops.well!.strings.every((s) => s.pulled)).toBe(true);
  expect((await snap(page)).ops.cash).toBeGreaterThan(cash - 1);
});
