import { expect, test, type Page } from "@playwright/test";

/**
 * M1: a single playable prospect. Observation (walking, asking about wells) becomes carmine
 * knowledge; interpretation (a line of section) is the player's own and can be rubbed out.
 * The test plays through the UI only, using public map data to know where to tap.
 */
const SEED = "00000000b1ac0003";

type Rt = { blackGold: { newCampaign(s: string): Promise<void>; snapshot(): { print: { hills: { x: number; y: number }[]; wells: { id: string; x: number; y: number; owner: string }[] }; knowledge: { evidence: { kind: string }[]; task: unknown } } } };
const snap = (page: Page) => page.evaluate(() => (window as unknown as Rt).blackGold.snapshot());

async function view(page: Page) {
  const raw = await page.getByTestId("map").getAttribute("data-view");
  const [cx, cy, s] = raw!.split(",").map(Number);
  return { cx: cx!, cy: cy!, s: s! };
}

/** Tap a place given in km, zooming out first if it is off the visible map. */
async function tapKm(page: Page, x: number, y: number) {
  const map = page.getByTestId("map");
  for (let i = 0; i < 4; i++) {
    const box = (await map.boundingBox())!;
    const v = await view(page);
    const px = (x - v.cx) * v.s + box.width / 2, py = (y - v.cy) * v.s + box.height / 2;
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

async function waitForReturn(page: Page) {
  await page.getByRole("radio", { name: "Skip" }).click();
  await expect.poll(async () => (await snap(page)).knowledge.task, { timeout: 15_000 }).toBeNull();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("date")).toHaveText("Wednesday, 1 January 1890");
  await page.evaluate((s) => (window as unknown as Rt).blackGold.newCampaign(s), SEED);
  await expect(page.getByTestId("map")).toHaveAttribute("data-view", /,/);
});

test("walk a survey: the party is out for days, Skip stops when it returns, and what it saw is recorded", async ({ page }) => {
  const hill = (await snap(page)).print.hills[0]!;
  await tapKm(page, hill.x, hill.y);
  await expect(page.getByRole("heading", { level: 2, name: /Survey$/ })).toBeVisible();
  await expect(page.getByText("Nothing is known of this survey yet. Blank paper means unknown, not empty.")).toBeVisible();

  await page.getByRole("button", { name: /Walk the ground/ }).click();
  await expect(page.getByTestId("task")).toContainText("The party is walking");
  await expect(page.getByRole("button", { name: /Walk the ground/ })).toBeDisabled();

  await waitForReturn(page);
  // Skip stopped at the party's return (an interrupt), at six in the evening, not at next month.
  await expect(page.getByRole("radio", { name: "Pause" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("clock")).toHaveText("18:00");
  await expect(page.getByTestId("status")).toContainText("Walked the");
  await expect(page.getByTestId("evidence")).toContainText("Walked the survey");
});

test("ask a settler about his well: his account becomes a log; then draw a section through it and rub it out", async ({ page }) => {
  const well = (await snap(page)).print.wells[0]!;
  await tapKm(page, well.x, well.y);
  await expect(page.getByRole("heading", { level: 2, name: `${well.owner}'s water well` })).toBeVisible();
  await expect(page.getByText(/Its record is unknown/)).toBeVisible();
  await page.getByRole("button", { name: `Ask ${well.owner} about his well` }).click();
  await waitForReturn(page);
  await expect(page.getByTestId("log")).toBeVisible();
  await expect(page.getByTestId("log").locator("tbody tr").first()).toContainText("0");

  await page.getByRole("button", { name: "Draw section" }).click();
  await expect(page.getByText("Tap where the line of section should begin.")).toBeVisible();
  await tapKm(page, well.x - 1.2, well.y - 0.4);
  await expect(page.getByText("Tap where the line should end.")).toBeVisible();
  await tapKm(page, well.x + 1.2, well.y + 0.4);
  await expect(page.getByRole("heading", { level: 2, name: "Section A—A′" })).toBeVisible();
  await expect(page.getByTestId("section")).toBeVisible();
  await expect(page.getByText(/Section along A—A′: what the company knows/)).toBeVisible();

  await page.getByRole("button", { name: "Rub it out" }).click();
  await expect(page.getByText("No line of section yet")).toBeVisible();
  // Rubbing out an interpretation never removes evidence.
  expect((await snap(page)).knowledge.evidence.some((e) => e.kind === "wellRecord")).toBe(true);
});

test("knowledge is saved and loaded with the campaign", async ({ page }) => {
  const well = (await snap(page)).print.wells[1]!;
  await tapKm(page, well.x, well.y);
  await page.getByRole("button", { name: `Ask ${well.owner} about his well` }).click();
  await waitForReturn(page);
  const count = (await snap(page)).knowledge.evidence.length;
  expect(count).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  await page.getByRole("button", { name: "Save now" }).click();
  await expect(page.getByTestId("status")).toContainText("Saved:");
  await page.getByRole("button", { name: "New campaign…" }).click();
  await page.getByRole("button", { name: "Start new campaign" }).click();
  expect((await snap(page)).knowledge.evidence.length).toBe(0);

  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  await page.locator(".save", { hasText: "Saved ·" }).getByRole("button", { name: "Load" }).click();
  await expect.poll(async () => (await snap(page)).knowledge.evidence.length).toBe(count);
});
