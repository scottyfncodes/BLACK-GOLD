import { expect, test, type Page } from "@playwright/test";
import { SURVEYS, centroid } from "../../src/content/geography/surveys";

/**
 * Regressions for the PR #5 gameplay review, played through the UI on phone and desktop:
 * the idle rig, the soft-lock after a failed well, and the campaign's two verdicts.
 */
type Snap = {
  speed: string;
  status: string;
  print: { hills: { x: number; y: number }[] };
  ops: { cash: number; debt: number; well: { status: string; depthFt: number; auto: boolean; outcome?: string } | null; contract: unknown; outcome: { ended: string | null; firstOilAt: number | null } };
};
type Runtime = { snapshot(): Snap; newCampaign(s: string): Promise<void>; command(t: string, p: unknown): string | null; setSpeed(s: string): void };
const rt = <T,>(page: Page, fn: (g: Runtime, arg: never) => T, arg?: unknown) => page.evaluate(([f, a]) => new Function("g", "a", `return (${f})(g, a)`)((window as unknown as { blackGold: Runtime }).blackGold, a), [fn.toString(), arg] as const) as Promise<Awaited<T>>;
const snap = (page: Page) => rt(page, (g) => g.snapshot());

async function start(page: Page, seed: string) {
  await page.goto("/");
  await expect(page.getByTestId("date")).toBeVisible();
  await rt(page, (g, s: string) => g.newCampaign(s), seed);
  await expect(page.getByTestId("map")).toHaveAttribute("data-view", /,/);
}

/** Tap a place given in km, zooming out first if it is off the visible map. */
async function tapKm(page: Page, x: number, y: number) {
  const map = page.getByTestId("map");
  for (let i = 0; i < 5; i++) {
    await map.scrollIntoViewIfNeeded();
    const box = (await map.boundingBox())!;
    const [cx, cy, s] = (await map.getAttribute("data-view"))!.split(",").map(Number);
    const px = (x - cx!) * s! + box.width / 2, py = (y - cy!) * s! + box.height / 2;
    if (px > 24 && px < box.width - 24 && py > 24 && py < box.height - 24) {
      await map.click({ position: { x: px, y: py } });
      return;
    }
    const before = await map.getAttribute("data-view");
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect(map).not.toHaveAttribute("data-view", before!);
  }
  throw new Error(`(${x}, ${y}) km is not on the map`);
}

/** Skip until the clock stops by itself (an interrupt or the month's end). */
async function skipOnce(page: Page) {
  await rt(page, (g) => g.setSpeed("skip"));
  await expect.poll(async () => (await snap(page)).speed, { timeout: 15_000 }).toBe("paused");
}

/** Lease and spud through the runtime's command path (the same one the buttons use), driller on. */
async function drillWithDriller(page: Page, surveyIndex: number) {
  const s = SURVEYS[surveyIndex]!;
  const [x, y] = centroid(s.poly);
  expect(await rt(page, (g, a: { id: string; x: number; y: number }) => g.command("lease.take", { surveyId: a.id, offer: "asking" }) ?? g.command("rig.spud", { x: a.x, y: a.y }) ?? g.command("rig.auto", { on: true }), { id: s.id, x, y })).toBeNull();
  for (let i = 0; i < 80; i++) {
    const w = (await snap(page)).ops.well!;
    if (w.status === "gusher" || w.status === "dry") return w;
    if (w.status === "stuck") await rt(page, (g) => g.command("rig.fish", {}));
    await skipOnce(page);
  }
  throw new Error("the well never finished");
}

/** The review's world: Big Hill straddles a survey line; the leased Delacroix survey takes the well. */
const REVIEW_SEED = "e459b94df4abf2ce";

test("review scenario: leaving the rig after the derrick is up hands it to the driller; Skip no longer loses the company", async ({ page }) => {
  test.setTimeout(60_000);
  await start(page, REVIEW_SEED);
  const hill = (await snap(page)).print.hills[0]!;
  await tapKm(page, hill.x - 0.15, hill.y - 0.1);
  await page.getByTestId("lease-asking").click();
  await page.getByTestId("stake").click();
  await tapKm(page, hill.x - 0.15, hill.y - 0.1);
  const rig = page.getByRole("dialog", { name: /The rig/ });
  await expect(rig).toBeVisible();
  await rig.getByRole("radio", { name: "16×" }).click();
  await expect.poll(async () => (await snap(page)).ops.well!.status, { timeout: 20_000 }).toBe("drilling");
  await expect(page.getByTestId("rig-status")).toContainText("or let the driller work");
  expect((await snap(page)).status).toContain("Take the controls, or let the driller work");
  const cash = (await snap(page)).ops.cash;
  // Exactly what the review did: back to the map, then Skip twice.
  await rig.getByRole("button", { name: "← Map" }).click();
  await expect(page.getByTestId("status")).toContainText("The driller has the tools while you are away");
  await expect(page.getByTestId("rigline")).toContainText("driller at work");
  await expect(page.getByTestId("days-left")).toContainText("days of money");
  // Skip twice. If the driller stops the clock to recommend something, answer him as a player would.
  for (let k = 0; k < 2; k++) {
    const advice = page.getByTestId("advice-sheet");
    if (await advice.isVisible()) await advice.getByTestId("advice-no").click();
    await page.getByRole("radio", { name: "Skip" }).click();
    await expect.poll(async () => (await snap(page)).speed, { timeout: 15_000 }).toBe("paused");
  }
  const s = await snap(page);
  expect(s.ops.well!.depthFt).toBeGreaterThan(20); // the review's well was abandoned at 2 ft
  expect(s.ops.cash).toBeGreaterThan(0);
  expect(s.ops.cash).toBeLessThan(cash);
});

test("review scenario: at 16× in the rig with nobody on the line, the clock stops and says why", async ({ page }) => {
  test.setTimeout(60_000);
  await start(page, REVIEW_SEED);
  const hill = (await snap(page)).print.hills[0]!;
  await tapKm(page, hill.x - 0.15, hill.y - 0.1);
  await page.getByTestId("lease-asking").click();
  await page.getByTestId("stake").click();
  await tapKm(page, hill.x - 0.15, hill.y - 0.1);
  const rig = page.getByRole("dialog", { name: /The rig/ });
  await rig.getByRole("radio", { name: "16×" }).click();
  await expect.poll(async () => (await snap(page)).ops.well!.status, { timeout: 20_000 }).toBe("drilling");
  const cash = (await snap(page)).ops.cash;
  await rig.getByRole("radio", { name: "16×" }).click();
  // Three idle game hours later, the clock stops itself.
  await expect.poll(async () => (await snap(page)).speed, { timeout: 20_000 }).toBe("paused");
  await expect(page.getByTestId("rig-status")).toContainText("Nobody is working the line");
  expect(cash - (await snap(page)).ops.cash).toBeLessThan(2);
  // One tap hands it to the driller.
  await page.getByTestId("driller").click();
  await rig.getByRole("radio", { name: "16×" }).click();
  await expect.poll(async () => (await snap(page)).ops.well!.depthFt, { timeout: 20_000 }).toBeGreaterThan(15);
});

test("the driller can be engaged while the derrick is going up", async ({ page }) => {
  await start(page, REVIEW_SEED);
  const hill = (await snap(page)).print.hills[0]!;
  await tapKm(page, hill.x - 0.15, hill.y - 0.1);
  await page.getByTestId("lease-asking").click();
  await page.getByTestId("stake").click();
  await tapKm(page, hill.x - 0.15, hill.y - 0.1);
  await expect(page.getByTestId("driller")).toBeEnabled();
  await page.getByTestId("driller").click();
  await expect(page.getByTestId("driller")).toContainText("Driller ready");
  await page.getByRole("dialog", { name: /The rig/ }).getByRole("radio", { name: "16×" }).click();
  await expect.poll(async () => (await snap(page)).status, { timeout: 20_000 }).toContain("The driller is making hole");
});

test("review scenario: broke with the rig after a dry hole, the books offer contract work and the company recovers", async ({ page }) => {
  test.setTimeout(90_000);
  await start(page, REVIEW_SEED);
  const well = await drillWithDriller(page, 3);
  expect(well.status).toBe("dry");
  const s0 = await snap(page);
  expect(s0.ops.outcome.ended).toBeNull();
  await page.getByTestId("next").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("next")).toContainText("Take a contract with the rig");
  await expect(page.getByTestId("next")).not.toContainText("bank will lend against the rig");
  await page.getByTestId("books").click();
  const books = page.getByRole("dialog", { name: "The Company's Books" });
  await expect(books.getByTestId("take-contract")).toBeVisible();
  if (s0.ops.cash < 150) await expect(books.getByTestId("take-contract")).toContainText("Borrow $150 and take a contract");
  await books.getByTestId("take-contract").click();
  await expect(books.getByTestId("contract")).toContainText("out on contract");
  await books.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("rigline")).toContainText("out on contract");
  const before = (await snap(page)).ops.cash;
  for (let i = 0; i < 3 && (await snap(page)).ops.contract; i++) await skipOnce(page);
  expect((await snap(page)).ops.contract).toBeNull();
  expect((await snap(page)).ops.cash).toBeGreaterThan(before + 390);
  expect((await snap(page)).ops.outcome.ended).toBeNull();
});

test("borrowing to the limit and losing it ends the campaign plainly, and a new one can start", async ({ page }) => {
  test.setTimeout(90_000);
  await start(page, REVIEW_SEED);
  expect(await rt(page, (g) => g.command("bank.borrow", { cents: 30_000 }))).toBeNull();
  await drillWithDriller(page, 3);
  const over = page.getByTestId("campaign-over");
  await expect(over).toBeVisible();
  await expect(over).toContainText("The company is finished.");
  await expect(over.getByRole("listitem")).toHaveCount(1);
  await expect(over).toContainText("spent");
  await over.getByTestId("new-campaign").click();
  await expect(over).toBeHidden();
  await expect(page.getByTestId("cash")).toHaveText("$1,500");
  await expect(page.getByTestId("goal-head")).toHaveText("Bring in a well before the money runs out.");
});

test("the first producing well is acknowledged as the goal met", async ({ page }) => {
  test.setTimeout(90_000);
  // A world whose hill flank holds shallow oil, with no running sand above it (found with truth, test only).
  await start(page, "00000000000e0895");
  const hill = (await snap(page)).print.hills[0]!;
  await tapKm(page, hill.x + 0.15, hill.y + 0.1);
  await page.getByTestId("lease-asking").click();
  await page.getByTestId("stake").click();
  await tapKm(page, hill.x + 0.15, hill.y + 0.1);
  const rig = page.getByRole("dialog", { name: /The rig/ });
  await page.getByTestId("driller").click();
  await rig.getByRole("button", { name: "← Map" }).click();
  for (let i = 0; i < 60; i++) {
    const w = (await snap(page)).ops.well!;
    if (w.status === "gusher" || w.status === "dry") break;
    if (w.status === "stuck") await rt(page, (g) => g.command("rig.fish", {}));
    await skipOnce(page);
  }
  expect((await snap(page)).ops.well!.outcome).toMatch(/^OIL/);
  await page.getByTestId("to-rig").click();
  await page.getByTestId("cap").click();
  const sheet = page.getByTestId("first-oil");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("A producing well.");
  await expect(sheet).toContainText("The goal is met");
  await sheet.getByTestId("carry-on").click();
  await expect(sheet).toBeHidden();
  const rigView = page.getByRole("dialog", { name: /The rig/ });
  await rigView.getByRole("button", { name: /Back to the map|← Map/ }).first().click();
  // The map's keys listen only once the rig has closed and the page has re-rendered: an Escape sent
  // in between is ignored (this flaked on slow CI runners), so press it until the front page shows.
  await expect(rigView).toBeHidden();
  await expect(async () => {
    await page.keyboard.press("Escape"); // back to the field notes' front page
    await expect(page.getByTestId("goal-head"), "Escape should bring back the field notes' front page").toBeAttached({ timeout: 1_000 });
  }, "Escape never brought back the field notes' front page (tried for 10 s)").toPass({ timeout: 10_000, intervals: [250, 500, 1_000] });
  await page.getByTestId("goal-head").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("goal-head")).toHaveText("You brought in a producing well.");
});
