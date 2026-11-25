import { expect, test, type Page } from "@playwright/test";

/**
 * The books and the bank, by the UI only: the purse in the clock bar, borrowing against the
 * rig, a month's interest entered in the cash book, and repaying the loan.
 */
const SEED = "00000000b1ac0003";
type Snap = { time: number; ops: { cash: number; debt: number } };
const snap = (page: Page) => page.evaluate(() => (window as unknown as { blackGold: { snapshot(): Snap } }).blackGold.snapshot());

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("date")).toHaveText("Wednesday, 1 January 1890");
  await page.evaluate((s) => (window as unknown as { blackGold: { newCampaign(s: string): Promise<void> } }).blackGold.newCampaign(s), SEED);
  await expect(page.getByTestId("map")).toHaveAttribute("data-view", /,/);
});

test("the clock bar shows the cash; the books open on the company's position and the cash book", async ({ page }) => {
  await expect(page.getByTestId("cash")).toHaveText("$1,500");
  await expect(page.getByTestId("debt")).toHaveCount(0);
  await page.getByTestId("books").click();
  const books = page.getByRole("dialog", { name: "The Company's Books" });
  await expect(books).toBeVisible();
  await expect(books.getByTestId("books-cash")).toHaveText("$1,500.00");
  await expect(books.getByTestId("books-debt")).toHaveText("Nothing");
  await expect(books.getByTestId("ledger")).toContainText("January 1890");
  await expect(books.getByTestId("ledger")).toContainText("Capital");
  await books.getByText("Every entry").first().click();
  await expect(books.getByRole("cell", { name: "Capital paid in" })).toBeVisible();
  await books.getByRole("button", { name: "Close" }).click();
  await expect(books).toBeHidden();
});

test("borrow against the rig, pay a month's interest, and repay the loan", async ({ page }) => {
  test.setTimeout(60_000);
  await page.getByTestId("books").click();
  const books = page.getByRole("dialog", { name: "The Company's Books" });
  await expect(books.getByTestId("bank")).toContainText("up to $300");
  await books.getByTestId("borrow-all").click();
  await expect(books.getByTestId("books-debt")).toHaveText("$300.00");
  await expect(books.getByTestId("borrow")).toBeDisabled();
  await books.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("debt")).toHaveText("owes $300");
  await expect(page.getByTestId("cash")).toHaveText("$1,800");

  // Skip runs to the start of next month, where the interest is taken.
  await page.getByRole("radio", { name: "Skip" }).click();
  await expect.poll(async () => (await snap(page)).ops.cash, { timeout: 30_000 }).toBeLessThan(1800);
  await page.getByRole("radio", { name: "Pause" }).click();
  expect((await snap(page)).ops.cash).toBeCloseTo(1797.46, 2); // 31 days at 10% on $300: $2.54

  await page.getByTestId("books").click();
  await expect(books.getByTestId("ledger")).toContainText("February 1890");
  await books.getByText("Every entry").first().click();
  await expect(books.getByRole("cell", { name: /Interest to the bank, January, at 10% a year/ })).toBeVisible();
  await books.getByTestId("repay").click();
  await expect(books.getByTestId("books-debt")).toHaveText("$250.00");
  await books.getByTestId("repay-all").click();
  await expect(books.getByTestId("books-debt")).toHaveText("Nothing");
  await expect(books.getByTestId("books-cash")).toHaveText("$1,497.46");
  await books.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("debt")).toHaveCount(0);
});

test("the books fit the screen: no sideways scrolling, every control reachable", async ({ page }) => {
  await page.getByTestId("books").click();
  const books = page.getByRole("dialog", { name: "The Company's Books" });
  await books.getByText("Every entry").first().click();
  const over = await books.evaluate((d) => d.scrollWidth - d.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
  for (const id of ["borrow", "repay", "sell-rig-ask"]) {
    const b = (await books.getByTestId(id).boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
  const purse = (await page.getByTestId("books").boundingBox())!;
  expect(purse.height).toBeGreaterThanOrEqual(40);
});

test("selling the rig takes a second, informed tap, and the bank is paid first", async ({ page }) => {
  await page.getByTestId("books").click();
  const books = page.getByRole("dialog", { name: "The Company's Books" });
  await expect(books.getByTestId("position")).toContainText("Owned · $1,500");
  await expect(books.getByTestId("oil-price")).toHaveText("77¢ a barrel");
  await books.getByTestId("borrow-all").click();
  await books.getByTestId("sell-rig-ask").click();
  const sell = books.getByTestId("sell-rig");
  await expect(sell).toContainText("fetches $750 in Beaumont");
  await expect(sell).toContainText("loses $750");
  await expect(sell).toContainText("$300 of the price goes against the loan");
  await expect(sell).toContainText("costs $900 to buy back");
  const confirm = (await books.getByTestId("sell-rig-confirm").boundingBox())!;
  expect(confirm.height).toBeGreaterThanOrEqual(44);
  await books.getByRole("button", { name: "Keep the rig" }).click();
  await expect(books.getByTestId("sell-rig-confirm")).toHaveCount(0);
  await books.getByTestId("sell-rig-ask").click();
  await books.getByTestId("sell-rig-confirm").click();
  await expect(books.getByTestId("books-debt")).toHaveText("Nothing");
  await expect(books.getByTestId("books-cash")).toHaveText("$2,250.00");
  await expect(books.getByTestId("buy-rig")).toBeVisible();
  await expect(books.getByTestId("recover")).toContainText("cost $900");
});
