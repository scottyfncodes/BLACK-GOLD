import { expect, test, type Page } from "@playwright/test";

/**
 * M7, Reading the Ground, through the UI on phone and desktop: fieldwork costs money and says so;
 * the geologist's depth reading appears as an interpretation, naming what it rests on; an ended
 * hole's account says what it proved, what the company may make of it, and what is still unknown;
 * the next reading of the rise is built on the company's own log. Public map data says where to tap.
 */
// A world whose Big Hill has rock at about 570 ft, dry to the salt (found with truth, test only).
const SEED = "00000000000a5ccd";

type Snap = {
  speed: string;
  ops: { cash: number; well: { status: string } | null; crew: { pending: { id: number } | null } };
  print: { hills: { x: number; y: number }[] };
  knowledge: { task: unknown; evidence: { kind: string; verdict?: string; basis?: string[] }[] };
};
type Runtime = { snapshot(): Snap; newCampaign(s: string): Promise<void>; command(t: string, p: unknown): string | null; setSpeed(s: string): void };
const rt = <T,>(page: Page, fn: (g: Runtime, arg: never) => T, arg?: unknown) => page.evaluate(([f, a]) => new Function("g", "a", `return (${f})(g, a)`)((window as unknown as { blackGold: Runtime }).blackGold, a), [fn.toString(), arg] as const) as Promise<Awaited<T>>;
const snap = (page: Page) => rt(page, (g) => g.snapshot());

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

async function skipOnce(page: Page) {
  await rt(page, (g) => g.setSpeed("skip"));
  await expect.poll(async () => (await snap(page)).speed, { timeout: 15_000 }).toBe("paused");
}

async function geologist(page: Page) {
  const button = page.getByTestId("geologist");
  await expect(button).toContainText("$10");
  await button.click();
  await expect(page.getByTestId("task")).toContainText("A geologist is coming from Austin");
  for (let i = 0; i < 4 && (await snap(page)).knowledge.task; i++) await skipOnce(page);
  await expect.poll(async () => (await snap(page)).knowledge.task).toBeNull();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("date")).toBeVisible();
  await rt(page, (g, s: string) => g.newCampaign(s), SEED);
  await expect(page.getByTestId("map")).toHaveAttribute("data-view", /,/);
});

test("fieldwork costs money, and the geologist's depth reading is shown as an interpretation", async ({ page }) => {
  const hill = (await snap(page)).print.hills[0]!;
  await tapKm(page, hill.x, hill.y);
  await expect(page.getByTestId("walk")).toContainText("$");
  await geologist(page);
  expect((await snap(page)).ops.cash).toBe(1_490);
  const reading = page.getByTestId("reading");
  await reading.scrollIntoViewIfNeeded();
  await expect(reading).toContainText("a reading, not a fact");
  await expect(reading).toContainText(/the rock is looked for at [\d,]+ to [\d,]+ ft: the geologist put the rock/);
  await expect(page.getByTestId("evidence")).toContainText("an interpretation, from a rise he measured");
});

test("an ended hole's account says what it proved and what is unknown, and the next reading is built on it", async ({ page }) => {
  test.setTimeout(120_000);
  const hill = (await snap(page)).print.hills[0]!;
  await tapKm(page, hill.x, hill.y);
  await page.getByTestId("lease-asking").click();
  await page.getByTestId("stake").click();
  await tapKm(page, hill.x, hill.y);
  const rig = page.getByRole("dialog", { name: /The rig/ });
  await page.getByTestId("driller").click();
  await rig.getByRole("button", { name: "← Map" }).click();
  await expect(rig).toBeHidden();
  for (let i = 0; i < 80; i++) {
    const s = await snap(page);
    if (s.ops.well?.status === "dry" || s.ops.well?.status === "gusher") break;
    if (s.ops.crew.pending) await rt(page, (g, id: number) => g.command("crew.accept", { id }), s.ops.crew.pending.id);
    else if (s.ops.well?.status === "stuck") await rt(page, (g) => g.command("rig.fish", {}));
    await skipOnce(page);
  }
  expect((await snap(page)).ops.well!.status).toBe("dry");

  // At the rig: the account of the hole, opened by the player.
  await page.getByTestId("to-rig").click();
  const account = page.getByTestId("rig-result").getByTestId("account");
  await expect(account).toBeVisible();
  await account.locator("summary").click();
  await expect(account).toContainText("Proved, by the bailer");
  await expect(account).toContainText("Rock salt at about");
  await expect(account).toContainText("a reading, not a proof");
  await expect(account).toContainText("Still unknown");
  await page.getByRole("dialog", { name: /The rig/ }).getByRole("button", { name: /Back to the map|← Map/ }).first().click();
  await expect(page.getByRole("dialog", { name: /The rig/ })).toBeHidden();

  // The geologist, sent for again, reads the company's own log, not the lie of the land.
  await tapKm(page, hill.x, hill.y);
  await geologist(page);
  const last = (await snap(page)).knowledge.evidence.filter((e) => e.kind === "reading").at(-1)!;
  expect(last.verdict).toBe("dry");
  expect(last.basis![0]).toMatch(/the log of the/);
  await expect(page.getByTestId("reading")).toContainText("No oil in the rock here, by our reading");
});
