import { expect, test, type Page } from "@playwright/test";

/**
 * First Gusher: stake a well, raise the derrick, make hole by feeding the line, bail a
 * sample, hand the tools to the driller, and see the well on the map. UI only.
 */
const SEED = "00000000b1ac0003";
type Snap = { print: { hills: { x: number; y: number }[] }; ops: { cash: number; well: { status: string; depthFt: number; feeding: boolean } | null }; knowledge: { evidence: { kind: string }[] } };
const snap = (page: Page) => page.evaluate(() => (window as unknown as { blackGold: { snapshot(): Snap } }).blackGold.snapshot());

/** Tap a place given in km, zooming out first if it is off the visible map. */
async function tapKm(page: Page, x: number, y: number) {
  const map = page.getByTestId("map");
  for (let i = 0; i < 4; i++) {
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

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("date")).toHaveText("Wednesday, 1 January 1890");
  await page.evaluate((s) => (window as unknown as { blackGold: { newCampaign(s: string): Promise<void> } }).blackGold.newCampaign(s), SEED);
  await expect(page.getByTestId("map")).toHaveAttribute("data-view", /,/);
});

test("the plate states the goal and the next step", async ({ page }) => {
  await expect(page.getByTestId("goal")).toContainText("Bring in a well before the money runs out.");
  await expect(page.getByTestId("goal")).toContainText("Next:");
});

test("stake a well, raise the derrick, feed the line, bail, and hand over to the driller", async ({ page }) => {
  test.setTimeout(75_000);
  const hill = (await snap(page)).print.hills[0]!;
  await tapKm(page, hill.x, hill.y);
  await page.getByTestId("lease-asking").click();
  await page.getByTestId("stake").click();
  await expect(page.getByText("Tap where the derrick should stand.")).toBeVisible();
  await tapKm(page, hill.x + 0.15, hill.y + 0.1);

  // The rig opens on the derrick going up; raising it costs money.
  await expect(page.getByRole("dialog", { name: /The rig/ })).toBeVisible();
  await expect(page.getByTestId("rig-scene")).toBeVisible();
  expect((await snap(page)).ops.cash).toBeLessThan(1500);
  await page.getByRole("radio", { name: "16×" }).click();
  await expect.poll(async () => (await snap(page)).ops.well!.status, { timeout: 20_000 }).toBe("drilling");
  await page.getByRole("radio", { name: "1×" }).click();

  // Feeding the line makes hole.
  const feed = page.getByTestId("feed");
  const box = (await feed.boundingBox())!;
  for (let k = 0; k < 4; k++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    await page.waitForTimeout(700);
  }
  await expect.poll(async () => (await snap(page)).ops.well!.depthFt).toBeGreaterThan(2);

  // Bailing brings up a sample: evidence the company now has.
  const before = (await snap(page)).knowledge.evidence.filter((e) => e.kind === "sample").length;
  await page.getByRole("button", { name: /^Bail/ }).click();
  await expect.poll(async () => (await snap(page)).knowledge.evidence.filter((e) => e.kind === "sample").length, { timeout: 15_000 }).toBeGreaterThan(before);

  // The driller can run the tools.
  const handed = (await snap(page)).ops.well!.depthFt;
  await page.getByRole("button", { name: /Let the driller/ }).click();
  await page.getByRole("radio", { name: "16×" }).click();
  await expect.poll(async () => (await snap(page)).ops.well!.depthFt, { timeout: 30_000 }).toBeGreaterThan(handed + 15);

  // Back on the map, the well is there and the notes point back to the rig.
  await page.getByRole("button", { name: "← Map" }).click();
  await expect(page.getByRole("dialog", { name: /The rig/ })).toBeHidden();
  await expect(page.getByTestId("to-rig")).toBeVisible();
});

test("land must be leased before a well is staked; the bonus is paid from the books", async ({ page }) => {
  const hill = (await snap(page)).print.hills[0]!;
  await tapKm(page, hill.x, hill.y);
  await expect(page.getByTestId("lease")).toContainText("asks");
  await expect(page.getByTestId("stake")).toBeDisabled();
  await expect(page.getByTestId("stake")).toContainText("lease the land first");
  const cash = (await snap(page)).ops.cash;
  // One lower offer: the owner accepts or refuses, and the notes say which.
  await page.getByTestId("lease-lower").click();
  const leased = await page.getByText("The company's lease").isVisible();
  if (!leased) {
    await expect(page.getByTestId("status")).toContainText("refused");
    await expect(page.getByTestId("lease-lower")).toBeDisabled();
    await page.getByTestId("lease-asking").click();
  }
  await expect(page.getByTestId("lease")).toContainText("The company's lease");
  expect((await snap(page)).ops.cash).toBeLessThan(cash);
  await expect(page.getByTestId("stake")).toBeEnabled();
});

test("the rig fits the screen: no horizontal scroll, controls reachable", async ({ page }) => {
  const hill = (await snap(page)).print.hills[0]!;
  await tapKm(page, hill.x, hill.y);
  await page.getByTestId("lease-asking").click();
  await page.getByTestId("stake").click();
  await tapKm(page, hill.x + 0.15, hill.y + 0.1);
  await expect(page.getByTestId("rig-scene")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const name of [/^Bail/, /^Dress bit/, /^Set 10-inch/, /Let the driller/, "← Map"]) {
    const b = (await page.getByRole("button", { name }).boundingBox())!;
    expect(b.height, String(name)).toBeGreaterThanOrEqual(44);
    expect(b.y + b.height, String(name)).toBeLessThanOrEqual((page.viewportSize()?.height ?? 900) + 1);
  }
  const f = (await page.getByTestId("feed").boundingBox())!;
  expect(f.height).toBeGreaterThanOrEqual(56);
});
