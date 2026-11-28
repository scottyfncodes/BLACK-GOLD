import { expect, test, type Page } from "@playwright/test";

/**
 * M8b, the Rush, through the UI on phone and desktop: after the company's strike, other
 * operators come; the field's news is told in the notes as hearsay; their wells are on the map,
 * each with a page; a finished one's driller can be asked for his log; land they hold cannot be
 * leased. A world whose dome has oil at 1,335 ft under ground free of running sand (found with
 * truth, test only).
 */
const SEED = "0000000000b10005";
const STRIKE = { surveyId: "A-121-7-5", x: 19.5791, y: 11.4509 };

type Snap = {
  speed: string;
  ops: { well: { status: string; outcome?: string } | null; crew: { pending: { id: number; kind: string } | null }; rush: { wells: { id: string; x: number; y: number; status: string }[]; leases: { surveyId: string; until: number }[] }; production: { producers: unknown[] } };
  knowledge: { task: unknown; evidence: { kind: string; wellId?: string }[] };
  time: number;
};
type Runtime = { snapshot(): Snap; newCampaign(s: string): Promise<void>; command(t: string, p: unknown): string | null; setSpeed(s: string): void };
const rt = <T,>(page: Page, fn: (g: Runtime, arg: never) => T, arg?: unknown) => page.evaluate(([f, a]) => new Function("g", "a", `return (${f})(g, a)`)((window as unknown as { blackGold: Runtime }).blackGold, a), [fn.toString(), arg] as const) as Promise<Awaited<T>>;
const snap = (page: Page) => rt(page, (g) => g.snapshot());

async function skipOnce(page: Page) {
  await rt(page, (g) => g.setSpeed("skip"));
  await expect.poll(async () => (await snap(page)).speed, { timeout: 15_000 }).toBe("paused");
}

async function tapKm(page: Page, x: number, y: number) {
  const map = page.getByTestId("map");
  for (let i = 0; i < 6; i++) {
    await map.scrollIntoViewIfNeeded();
    const box = (await map.boundingBox())!;
    const [cx, cy, s] = (await map.getAttribute("data-view"))!.split(",").map(Number);
    const px = (x - cx!) * s! + box.width / 2, py = (y - cy!) * s! + box.height / 2;
    if (px > 24 && px < box.width - 24 && py > 24 && py < box.height - 24) { await map.click({ position: { x: px, y: py } }); return; }
    const before = await map.getAttribute("data-view");
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect(map).not.toHaveAttribute("data-view", before!);
  }
  throw new Error(`(${x}, ${y}) km is not on the map`);
}

test("after a strike other operators come: news in the notes, their wells on the map, their driller's log, their land closed", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/");
  await expect(page.getByTestId("date")).toBeVisible();
  await rt(page, (g, s: string) => g.newCampaign(s), SEED);
  await expect(page.getByTestId("map")).toHaveAttribute("data-view", /,/);
  // The strike, played through the runtime's command path (the same the buttons use).
  for (const [type, payload] of [["crew.orders", { authority: "judgement", budgetCents: 100_000 }], ["lease.take", { surveyId: STRIKE.surveyId, offer: "asking" }], ["rig.spud", { x: STRIKE.x, y: STRIKE.y }], ["rig.auto", { on: true }]] as const) {
    expect(await rt(page, (g, a: [string, unknown]) => g.command(a[0], a[1]), [type, payload])).toBeNull();
  }
  for (let i = 0; i < 80; i++) {
    const s = await snap(page);
    if (s.ops.well?.status === "gusher" || s.ops.well?.status === "dry") break;
    if (s.ops.crew.pending) await rt(page, (g, p: { id: number; kind: string }) => g.command(p.kind === "quit" || p.kind === "decide" ? "crew.decline" : "crew.accept", { id: p.id }), s.ops.crew.pending);
    if (s.ops.well?.status === "stuck") await rt(page, (g) => g.command("rig.fish", {}));
    await skipOnce(page);
  }
  expect((await snap(page)).ops.well!.outcome).toMatch(/^OIL/);
  expect(await rt(page, (g) => g.command("bank.borrow", { cents: 5_000 }) ?? g.command("prod.cap", {}))).toBeNull();
  // Months pass: the Rush comes and some of its wells finish.
  for (let i = 0; i < 14 && !(await snap(page)).ops.rush.wells.some((w) => w.status !== "drilling"); i++) await skipOnce(page);
  const s = await snap(page);
  const done = s.ops.rush.wells.find((w) => w.status !== "drilling")!;
  expect(done).toBeDefined();

  // The notes tell the field's news, as hearsay.
  await page.keyboard.press("Escape");
  const news = page.getByTestId("field-news");
  await news.scrollIntoViewIfNeeded();
  await expect(news).toContainText("news in Beaumont: hearsay");
  await expect(news).toContainText(/putting up a derrick|came in|abandoned dry|blew in gas/);

  // Their well has a page; its driller can be asked for his log, which then reads as hearsay.
  await tapKm(page, done.x, done.y);
  await expect(page.getByText("another operator's well")).toBeVisible();
  await page.getByTestId("ask-rival").click();
  for (let i = 0; i < 4 && (await snap(page)).knowledge.task; i++) await skipOnce(page);
  await expect(page.getByTestId("log")).toBeVisible();
  await expect(page.getByText(/Another man's log, as he remembers it: hearsay/)).toBeVisible();

  // Land another operator holds cannot be leased, and says whose it is.
  const held = (await snap(page)).ops.rush.leases.find((l) => l.until > s.time);
  if (held) expect(await rt(page, (g, id: string) => g.command("lease.take", { surveyId: id, offer: "asking" }), held.surveyId)).toMatch(/holds the .* lease/);
});
