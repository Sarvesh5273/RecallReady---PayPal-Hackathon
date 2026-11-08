import { chromium } from "playwright";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Record updated layouts and the existing completed transaction. Authentication
// remains in memory; no buyer checkout, new approval, or new purchase is opened.
const baseURL = "http://localhost:3000";
const output = resolve("recordings/submission/pickups");
if (
  await access(resolve(output, "capture-manifest.json"))
    .then(() => true)
    .catch(() => false)
)
  throw new Error("EXISTING_PICKUPS_PRESERVED");
const original = JSON.parse(
  await readFile(
    resolve("recordings/submission/capture-manifest.json"),
    "utf8",
  ),
);
const gate = original.gates.find((g) => g.type === "VERIFIED_SANDBOX_REFUND");
if (!gate || gate.status !== "COMPLETED")
  throw new Error("VERIFIED_RECORDING_REQUIRED");
await mkdir(output, { recursive: true });
const manifest = {
  workspaceId: original.workspaceId,
  originalAttemptId: gate.attemptId,
  refundId: gate.refundId,
  width: 1920,
  height: 1080,
  newPurchase: false,
  newApproval: false,
  newRefund: false,
  shots: [],
};
async function json(context, path) {
  const response = await context.request.get(path);
  if (!response.ok()) throw new Error("READ_FAILED: " + path);
  return response.json();
}
const loginBrowser = await chromium.launch({
  headless: false,
  args: ["--window-size=1320,840"],
});
const login = await loginBrowser.newContext({
  baseURL,
  viewport: { width: 1280, height: 720 },
});
const loginPage = await login.newPage();
await loginPage.goto("/login");
console.log(
  "PICKUP_SIGNIN_READY: Sign in with the existing RecallReady owner account. This login is not recorded. No purchase or new refund approval is needed.",
);
let auth;
const deadline = Date.now() + 30 * 60 * 1000;
while (Date.now() < deadline) {
  const response = await login.request.get("/api/session");
  if (response.ok()) {
    const session = await response.json();
    if (
      session.mode !== "PAYPAL_SANDBOX" ||
      session.workspaceId !== original.workspaceId
    )
      throw new Error("ORIGINAL_RECORDING_WORKSPACE_REQUIRED");
    auth = await login.storageState();
    break;
  }
  await delay(1500);
}
if (!auth) throw new Error("SIGNIN_TIMEOUT");
await loginBrowser.close();
// Headless capture prevents an OS window resize or browser zoom from clipping
// the recording while the user interacts with another window.
const browser = await chromium.launch({ headless: true });
let context, page, shot;
async function save() {
  await writeFile(
    resolve(output, "capture-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}
async function start(id, title) {
  context = await browser.newContext({
    baseURL,
    viewport: { width: 1920, height: 1080 },
    storageState: auth,
    recordVideo: {
      dir: resolve(output, "raw"),
      size: { width: 1920, height: 1080 },
    },
  });
  page = await context.newPage();
  shot = {
    id,
    title,
    startedAt: new Date().toISOString(),
    startMs: Date.now(),
    moments: [],
  };
}
function mark(label) {
  shot.moments.push({ label, seconds: (Date.now() - shot.startMs) / 1000 });
}
async function finish() {
  mark("end");
  const size = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    pageWidth: document.documentElement.scrollWidth,
  }));
  if (size.width !== 1920 || size.height !== 1080 || size.pageWidth !== 1920)
    throw new Error("RECORDING_VIEWPORT_CHANGED");
  await page.screenshot({ path: resolve(output, shot.id + "-final.png") });
  const video = page.video();
  await context.close();
  shot.rawVideo = await video.path();
  delete shot.startMs;
  manifest.shots.push(shot);
  await save();
  console.log("PICKUP_RECORDED: " + shot.id);
}
const lookup = await browser.newContext({ baseURL, storageState: auth });
const attempt = await json(lookup, "/api/attempts/" + gate.attemptId);
if (
  attempt.status !== "COMPLETED" ||
  attempt.provider_refund_id !== gate.refundId
)
  throw new Error("PRESERVED_REFUND_PROOF_CHANGED");
const rows = await json(lookup, "/api/cases");
const ids = Object.fromEntries(rows.map((r) => [r.display_id, r.id]));
await lookup.close();
try {
  await start("04", "Three case outcomes in the aligned layout");
  for (const id of ["RR-001", "RR-002", "RR-003"]) {
    await page.goto("/cases/" + ids[id]);
    await page.getByRole("heading", { name: id, exact: true }).waitFor();
    await page.getByText("Official source evidence", { exact: true }).waitFor();
    mark(id);
    if (id !== "RR-001") {
      const review = page.getByRole("button", {
        name: "Review courtesy refund",
        exact: true,
      });
      if (await review.isEnabled())
        throw new Error("NONMATCH_FINANCIAL_ACTION_ENABLED");
    }
    await delay(7300);
  }
  await finish();
  await start("05-result", "Verified completed refund in the aligned layout");
  await page.goto("/cases/" + ids["RR-001"]);
  await page
    .getByRole("heading", { name: "Courtesy refund completed", exact: true })
    .waitFor();
  await page.getByText("Payment details", { exact: true }).click();
  await page
    .getByText("Refund identifiers & verification", { exact: true })
    .click();
  await page.locator(".receipt-block").scrollIntoViewIfNeeded();
  mark("refund-completed");
  await delay(11000);
  await finish();
  await start("06", "Repeat returns the preserved attempt");
  await page.goto("/cases/" + ids["RR-001"]);
  await page
    .getByRole("heading", { name: "Courtesy refund completed", exact: true })
    .waitFor();
  await page
    .getByText("Refund identifiers & verification", { exact: true })
    .click();
  await page.locator(".receipt-block").scrollIntoViewIfNeeded();
  mark("before-repeat");
  await delay(5000);
  await page
    .getByRole("button", { name: "Re-submit this approval", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Existing attempt returned: " + gate.attemptId })
    .waitFor();
  mark("same-attempt");
  const repeated = await json(context, "/api/attempts/" + gate.attemptId);
  if (
    repeated.status !== "COMPLETED" ||
    repeated.provider_refund_id !== gate.refundId
  )
    throw new Error("REPEAT_PROOF_CHANGED");
  await delay(14000);
  await finish();
  await start("07", "Order search and completed filter");
  await page.goto("/workbench");
  await page
    .getByRole("heading", { name: "Your orders", exact: true })
    .waitFor();
  await page.locator(".workbench").scrollIntoViewIfNeeded();
  mark("grid");
  await delay(4000);
  await page.getByLabel("Search orders").fill("PB0004");
  await page.getByRole("button", { name: "RR-002", exact: true }).waitFor();
  mark("search");
  await delay(4000);
  await page.getByLabel("Search orders").fill("");
  await page.getByRole("button", { name: "More filters", exact: true }).click();
  await page.getByLabel("Filter payment state").selectOption("COMPLETED");
  await page.getByRole("button", { name: "RR-001", exact: true }).waitFor();
  mark("completed-filter");
  await delay(6500);
  await finish();
  manifest.finishedAt = new Date().toISOString();
  await save();
  console.log(
    "PICKUPS_FINISHED: Existing sandbox refund preserved. No new approvals or purchases.",
  );
} finally {
  await browser.close();
}
