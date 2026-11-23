import { expect, test } from "@playwright/test";

/**
 * M0 acceptance: the app is usable in under 2 s on a mid-range phone. Approximated with
 * 4× CPU throttling and a "fast 3G-ish" network profile (1.6 Mbps down, 150 ms RTT).
 */
test("is interactive in under 2 seconds on a throttled phone", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP throttling is Chromium-only");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });

  const start = Date.now();
  await page.goto("/");
  await expect(page.getByTestId("date")).toHaveText("Wednesday, 1 January 1890");
  await expect(page.getByRole("img", { name: /Map of Jefferson County/ })).toBeVisible();
  const elapsed = Date.now() - start;
  console.log(`Interactive after ${elapsed} ms`);
  expect(elapsed).toBeLessThan(2000);
});
