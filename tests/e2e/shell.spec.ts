import { expect, test, type Page } from "@playwright/test";

/** Game time straight from the runtime (exposed on window for tests). */
const gameTime = (page: Page) => page.evaluate(() => (window as unknown as { blackGold: { snapshot(): { time: number } } }).blackGold.snapshot().time);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("date")).toHaveText("Wednesday, 1 January 1890");
});

test("opens on New Year's Day 1890, paused, on Plate I with the map and an empty section", async ({ page }) => {
  await expect(page.getByTestId("clock")).toHaveText("06:00");
  await expect(page.getByRole("radio", { name: "Pause" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("heading", { name: "Jefferson County, Texas" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Map of Jefferson County/ })).toBeVisible();
  await expect(page.getByText("No line of section yet")).toBeVisible();
  await expect(page.getByText("Blank paper means unknown, not empty.")).toBeVisible();
});

test("time runs at each speed and stops when paused", async ({ page }) => {
  await page.getByRole("radio", { name: "16×" }).click();
  await page.waitForTimeout(600);
  await page.getByRole("radio", { name: "Pause" }).click();
  const t1 = await gameTime(page);
  expect(t1).toBeGreaterThan(360 + 300); // more than 5 game hours in 0.6 s
  await page.waitForTimeout(300);
  expect(await gameTime(page)).toBe(t1);
});

test("Skip runs to the start of next month and pauses itself", async ({ page }) => {
  await page.getByRole("radio", { name: "Skip" }).click();
  await expect(page.getByTestId("date")).toHaveText("Saturday, 1 February 1890");
  await expect(page.getByTestId("clock")).toHaveText("00:00");
  await expect(page.getByRole("radio", { name: "Pause" })).toHaveAttribute("aria-checked", "true");
});

test("autosaves at the month and resumes it after a reload", async ({ page }) => {
  await page.getByRole("radio", { name: "Skip" }).click();
  await expect(page.getByTestId("date")).toHaveText("Saturday, 1 February 1890");
  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  await expect(page.getByText("Autosave ·")).toBeVisible();
  const seed = await page.getByTestId("seed").textContent();

  await page.reload();
  await expect(page.getByTestId("date")).toHaveText("Saturday, 1 February 1890");
  await expect(page.getByTestId("status")).toContainText("Resumed your autosave");
  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  await expect(page.getByTestId("seed")).toHaveText(seed!);
});

test("manual save, new campaign, then load the save back", async ({ page }) => {
  await page.getByRole("radio", { name: "Skip" }).click();
  await expect(page.getByTestId("date")).toHaveText("Saturday, 1 February 1890");
  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  await page.getByRole("button", { name: "Save now" }).click();
  await expect(page.getByTestId("status")).toHaveText("Saved: 1 Feb 1890.");

  await page.getByLabel(/World seed/).fill("00000000000000ab");
  await page.getByRole("button", { name: "New campaign…" }).click();
  await page.getByRole("button", { name: "Start new campaign" }).click();
  await expect(page.getByTestId("date")).toHaveText("Wednesday, 1 January 1890");

  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  await expect(page.getByTestId("seed")).toHaveText("00000000000000ab");
  await page.locator(".save", { hasText: "Saved ·" }).getByRole("button", { name: "Load" }).click();
  await expect(page.getByTestId("date")).toHaveText("Saturday, 1 February 1890");
});

test("exports a save file and imports it back", async ({ page }) => {
  await page.getByRole("radio", { name: "Skip" }).click();
  await expect(page.getByTestId("date")).toHaveText("Saturday, 1 February 1890");
  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export file" }).click();
  const file = await (await download).path();

  await page.getByRole("button", { name: "New campaign…" }).click();
  await page.getByRole("button", { name: "Start new campaign" }).click();
  await expect(page.getByTestId("date")).toHaveText("Wednesday, 1 January 1890");

  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByTestId("date")).toHaveText("Saturday, 1 February 1890");
  await expect(page.getByTestId("status")).toHaveText("Imported: 1 Feb 1890.");
});

test("rejects a file that is not a save, with a readable message", async ({ page }) => {
  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "notes.blackgold", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByTestId("status")).toHaveText("This file is not a BLACK GOLD save.");
});

test("keyboard: Space toggles pause, number keys set speed", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard shortcuts are a desktop feature");
  await page.keyboard.press("3");
  await expect(page.getByRole("radio", { name: "16×" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press(" ");
  await expect(page.getByRole("radio", { name: "Pause" })).toHaveAttribute("aria-checked", "true");
});

test("layout: no horizontal scroll, touch-sized controls", async ({ page }) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const name of ["Pause", "1×", "4×", "16×", "Skip"]) {
    const box = (await page.getByRole("radio", { name }).boundingBox())!;
    expect(box.height, name).toBeGreaterThanOrEqual(44);
    expect(box.width, name).toBeGreaterThanOrEqual(44);
  }
  for (const name of ["Draw section", "Mark prospect", "Zoom in", "Zoom out"]) {
    const box = (await page.getByRole("button", { name }).boundingBox())!;
    expect(box.height, name).toBeGreaterThanOrEqual(44);
  }
  const map = (await page.getByRole("img", { name: /Map of Jefferson County/ }).boundingBox())!;
  expect(map.width).toBeGreaterThan(300);
  expect(map.height).toBeGreaterThan(280);
});

test("holds frame rate while running at 16×", async ({ page }) => {
  await page.getByRole("radio", { name: "16×" }).click();
  const fps = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const step = (now: number) => {
          frames++;
          if (now - start < 2000) requestAnimationFrame(step);
          else resolve((frames * 1000) / (now - start));
        };
        requestAnimationFrame(step);
      }),
  );
  expect(fps).toBeGreaterThan(55);
});
