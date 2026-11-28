import { expect, test, type Page } from "@playwright/test";

/**
 * M9a-0 through the UI on phone and desktop: a hole that makes no footage. The driller, trusted
 * with his own judgement, drives pipe through running sand until the sand runs in as fast as it
 * is bailed; then he says the hole is making no hole, what could still be tried, and that he'd
 * plug it, and asks. He does not plug it himself. A world with running sand at about 250 ft
 * (found by the M9.0 harness).
 */
const SEED = "00000000000ab99a";
const SITE = { surveyId: "A-121-7-5", x: 19.18983450497219, y: 10.780159621720504 };

type Snap = { speed: string; ops: { well: { status: string; outcome?: string } | null; crew: { pending: { id: number; kind: string } | null } } };
type Runtime = { snapshot(): Snap; newCampaign(s: string): Promise<void>; command(t: string, p: unknown): string | null; setSpeed(s: string): void };
const rt = <T,>(page: Page, fn: (g: Runtime, arg: never) => T, arg?: unknown) => page.evaluate(([f, a]) => new Function("g", "a", `return (${f})(g, a)`)((window as unknown as { blackGold: Runtime }).blackGold, a), [fn.toString(), arg] as const) as Promise<Awaited<T>>;
const snap = (page: Page) => rt(page, (g) => g.snapshot());

test("a hole that makes no footage: he says so, names what could be tried, and asks; plugging it ends the hole", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.getByTestId("date")).toBeVisible();
  await rt(page, (g, s: string) => g.newCampaign(s), SEED);
  await expect(page.getByTestId("map")).toHaveAttribute("data-view", /,/);
  for (const [type, payload] of [["crew.orders", { authority: "judgement", budgetCents: 100_000 }], ["lease.take", { surveyId: SITE.surveyId, offer: "asking" }], ["rig.spud", { x: SITE.x, y: SITE.y }], ["rig.auto", { on: true }]] as const) {
    expect(await rt(page, (g, a: [string, unknown]) => g.command(a[0], a[1]), [type, payload])).toBeNull();
  }
  // Play on, answering him as an owner would (pipe yes; the money, drill on), until he says the hole is making no hole.
  let stalled = false;
  for (let i = 0; i < 40 && !stalled; i++) {
    await rt(page, (g) => g.setSpeed("skip"));
    await expect.poll(async () => (await snap(page)).speed, { timeout: 15_000 }).toBe("paused");
    const p = (await snap(page)).ops.crew.pending;
    if (p?.kind === "stalled") stalled = true;
    else if (p) await rt(page, (g, q: { id: number; kind: string }) => g.command(q.kind === "quit" || q.kind === "decide" ? "crew.decline" : "crew.accept", { id: q.id }), p);
  }
  expect(stalled).toBe(true);
  expect((await snap(page)).ops.well!.status).toBe("drilling");

  // His advice, in his words, on the card: what he sees, what could still be tried, what he'd do.
  const card = page.getByTestId("advice").first();
  await expect(card).toBeVisible();
  await expect(card).toContainText(/made no hole/);
  await expect(card).toContainText(/as fast as we bail it|keeps running back in/);
  await expect(card).toContainText(/could still be driven|nothing smaller to drive/);
  await expect(card).toContainText(/I'd plug it/);
  await expect(card.getByTestId("advice-no")).toHaveText("Keep bailing");
  await expect(card.getByTestId("advice-yes")).toHaveText("Plug the hole");
  await card.getByTestId("advice-yes").click();
  await expect.poll(async () => (await snap(page)).ops.well!.status).toBe("dry");
  expect((await snap(page)).ops.well!.outcome).toMatch(/where no hole could be made/);
});
