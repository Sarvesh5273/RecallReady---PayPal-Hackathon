import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  await page.goto("http://localhost:3000");
  await page.getByRole("button", { name: "Open isolated simulation" }).click();
  await page
    .getByRole("button", { name: "Review courtesy refund", exact: true })
    .waitFor();
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/workbench.png",
    fullPage: true,
  });
  const rows = await page.evaluate(
    async () => await (await fetch("/api/cases")).json(),
  );
  const exact = rows.find((r) => r.display_id === "RR-001");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:3000/cases/" + exact.id);
  await page
    .getByRole("button", { name: "Review courtesy refund", exact: true })
    .waitFor();
  await page.screenshot({
    path: "docs/screenshots/mobile-case.png",
    fullPage: true,
  });
  console.log("Saved desktop and mobile simulation screenshots.");
} finally {
  await browser.close();
}
