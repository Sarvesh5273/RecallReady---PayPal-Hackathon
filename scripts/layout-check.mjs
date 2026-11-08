import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  baseURL: "http://localhost:3000",
});
const page = await context.newPage();
await mkdir("recordings/layout-check", { recursive: true });
const results = [];
async function inspect(label) {
  const measurement = await page.evaluate(() => ({
    viewport: { w: innerWidth, h: innerHeight },
    scrollY,
    pageWidth: document.documentElement.scrollWidth,
    boxes: Object.fromEntries(
      [
        ".app-shell",
        ".sidebar",
        ".topbar",
        ".main-shell",
        ".standalone",
        ".detail-panel",
        ".case-evidence",
        ".case-action",
        ".approval-box",
        ".approval-box .actions",
        ".source-layout",
        ".source-layout > .stack",
      ].map((s) => {
        const e = document.querySelector(s);
        if (!e) return [s, null];
        const r = e.getBoundingClientRect(),
          c = getComputedStyle(e);
        return [
          s,
          {
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
            alignSelf: c.alignSelf,
            position: c.position,
            overflowX: c.overflowX,
            overflowY: c.overflowY,
          },
        ];
      }),
    ),
  }));
  results.push({ label, ...measurement });
  console.log(JSON.stringify(results.at(-1)));
  if (measurement.pageWidth > measurement.viewport.w)
    throw new Error(label + ": horizontal overflow");
  if (measurement.boxes[".topbar"]?.y !== 0)
    throw new Error(label + ": header moved offscreen");
  if (measurement.viewport.w > 600 && measurement.boxes[".sidebar"]?.y !== 0)
    throw new Error(label + ": sidebar moved offscreen");
  if (label.startsWith("approval")) {
    const actions = measurement.boxes[".approval-box .actions"];
    if (actions.y < 60 || actions.y + actions.h > measurement.viewport.h + 1)
      throw new Error(label + ": approval buttons clipped");
  }
  await page.screenshot({ path: "recordings/layout-check/" + label + ".png" });
}
try {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open isolated simulation", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Your orders", exact: true })
    .waitFor();
  const rows = await (await context.request.get("/api/cases")).json(),
    row = rows.find((r) => r.display_id === "RR-001");
  await page.goto("/cases/" + row.id);
  await page
    .getByRole("button", { name: "Review courtesy refund", exact: true })
    .waitFor();
  await inspect("case-top");
  await page
    .getByRole("button", { name: "Review courtesy refund", exact: true })
    .click();
  await page.locator(".approval-box .actions").scrollIntoViewIfNeeded();
  await inspect("approval-scrolled");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".approval-box .actions").scrollIntoViewIfNeeded();
  await inspect("approval-1440");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator(".approval-box .actions").scrollIntoViewIfNeeded();
  await inspect("approval-1280");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".approval-box .actions").scrollIntoViewIfNeeded();
  await inspect("approval-mobile");
  await page
    .getByText("Immutable approval fingerprint", { exact: true })
    .click();
  await page.getByText("Optional operator note", { exact: true }).click();
  await page.locator(".approval-box .actions").scrollIntoViewIfNeeded();
  await inspect("approval-mobile-expanded");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/sources");
  await page
    .getByRole("heading", { name: "Supported product facts", exact: true })
    .waitFor();
  await inspect("source-top");
  await writeFile(
    "recordings/layout-check/measurements.json",
    JSON.stringify(results, null, 2) + "\n",
  );
} finally {
  await context.close();
  await browser.close();
}
