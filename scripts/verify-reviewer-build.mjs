import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const baseURL = "http://localhost:3100";
const output = "recordings/submission/reviewer-check";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL,
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
try {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open isolated simulation", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Your orders", exact: true })
    .waitFor();
  const session = await (await context.request.get("/api/session")).json();
  assert.equal(session.mode, "SIMULATION");
  const rows = await (await context.request.get("/api/cases")).json();
  assert.equal(rows.length, 24);
  for (const [id, expected] of [
    ["RR-002", "NOT_MATCHED_TO_NOTICE"],
    ["RR-003", "NEEDS_REVIEW"],
  ]) {
    const row = rows.find((r) => r.display_id === id);
    assert.equal(row.match_state, expected);
    await page.goto("/cases/" + row.id);
    const button = page.getByRole("button", {
      name: "Review courtesy refund",
      exact: true,
    });
    await button.waitFor();
    assert.equal(await button.isEnabled(), false);
  }
  const exact = rows.find((r) => r.display_id === "RR-001");
  assert.equal(exact.match_state, "EXACT_MATCH");
  await page.goto("/cases/" + exact.id);
  await page
    .getByRole("button", { name: "Review courtesy refund", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "I reviewed the evidence, merchant basis, and exact amount.",
    })
    .check();
  await page
    .getByRole("button", { name: "Approve courtesy refund", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Courtesy refund completed", exact: true })
    .waitFor({ timeout: 30000 });
  const before = await (
    await context.request.get("/api/cases/" + exact.id)
  ).json();
  assert.ok(before.attempt_id);
  await page
    .getByRole("button", { name: "Re-submit this approval", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Existing attempt returned: " + before.attempt_id })
    .waitFor();
  const after = await (
    await context.request.get("/api/cases/" + exact.id)
  ).json();
  assert.equal(before.attempt_id, after.attempt_id);
  const receipt = await (
    await context.request.get("/api/cases/" + exact.id + "/receipt")
  ).json();
  assert.equal(receipt.mode, "SIMULATION");
  assert.equal(receipt.courtesyAction.status, "COMPLETED");
  assert.equal(receipt.officialRemedy.manufacturerClaimSubmitted, false);
  await mkdir(output, { recursive: true });
  const report = {
    checkedAt: new Date().toISOString(),
    publicSourceCommit: "82d27495dfe506b189e30bdfe59f0493d9c29e73",
    source:
      "Downloaded public GitHub ZIP; production Docker build; new temporary PostgreSQL database",
    mode: session.mode,
    syntheticCases: rows.length,
    exactCaseCompleted: true,
    nearAndMissingCasesBlocked: true,
    repeatedAttemptPreserved: true,
    receiptVerified: true,
    externalProviderCredentialsUsed: false,
    paymentProviderWrites: 0,
    limitation:
      "Dependency installation layer reused Docker cache. This verifies a clean source archive and fresh database, not an uncached dependency install.",
  };
  await writeFile(
    output + "/reviewer-result.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await page.screenshot({ path: output + "/reviewer-result.png" });
  console.log(JSON.stringify(report));
} finally {
  await context.close();
  await browser.close();
}
