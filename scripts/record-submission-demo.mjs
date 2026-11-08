import { chromium } from "playwright";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const base = "http://localhost:3000",
  output = resolve("recordings/submission");
if (
  await access(resolve(output, "capture-manifest.json"))
    .then(() => true)
    .catch(() => false)
)
  throw new Error(
    "EXISTING_CAPTURE_PRESERVED: Archive the previous take deliberately before starting a new recording.",
  );
const state = JSON.parse(
  await readFile(resolve(output, "take-state.json"), "utf8"),
);
if (!state.sourceReady) throw new Error("VALIDATED_SOURCE_REQUIRED");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: false,
  args: ["--window-size=1940,1180"],
});
let setup = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  baseURL: base,
});
let setupPage = await setup.newPage();
const shotManifest = {
  startedAt: new Date().toISOString(),
  workspaceId: state.workspaceId,
  width: 1920,
  height: 1080,
  voiceoverGenerated: false,
  shots: [],
  gates: [],
};
async function saveManifest() {
  await writeFile(
    resolve(output, "capture-manifest.json"),
    JSON.stringify(shotManifest, null, 2) + "\n",
  );
}
async function waitForSession(context) {
  const deadline = Date.now() + 30 * 60000;
  while (Date.now() < deadline) {
    try {
      const r = await context.request.get("/api/session");
      if (r.ok()) {
        const s = await r.json();
        if (s.workspaceId === state.workspaceId && s.mode === "PAYPAL_SANDBOX")
          return;
      }
    } catch {}
    await delay(1500);
  }
  throw new Error("MANUAL_SIGNIN_TIMEOUT");
}
async function getJSON(context, path) {
  const r = await context.request.get(path);
  if (!r.ok()) throw new Error("READ_FAILED");
  return r.json();
}
async function waitFor(context, fn, label) {
  const deadline = Date.now() + 30 * 60000;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await delay(1500);
  }
  throw new Error(label + "_TIMEOUT");
}
await setupPage.goto("/login");
console.log(
  "MANUAL_SIGNIN_READY: Sign in to RecallReady in Chromium using your existing owner credentials. No video is recording yet.",
);
await waitForSession(setup);
await setupPage.goto("/demo/setup");
console.log(
  "MANUAL_PURCHASE_READY: Approve the fresh USD 49.00 purchase using your United States Sandbox Personal buyer. Login and checkout are not being recorded.",
);
await waitFor(
  setup,
  async () => {
    const c = await getJSON(setup, "/api/demo/setup/config");
    return (
      c.purchase?.owned &&
      c.purchase?.capture_id &&
      c.purchase.verified_state === "COMPLETED"
    );
  },
  "BUYER_APPROVAL",
);
const purchase = await getJSON(setup, "/api/demo/setup/config");
shotManifest.gates.push({
  type: "BUYER_APPROVED_CAPTURE",
  at: new Date().toISOString(),
  captureId: purchase.purchase.capture_id,
  orderId: purchase.purchase.provider_order_id,
  amountMinor: purchase.purchase.amount_minor,
  currency: purchase.purchase.currency,
});
let auth = await setup.storageState();
await setup.close();
await saveManifest();
console.log(
  "CAPTURE_VERIFIED: Beginning recorded app scenes. All footage uses this fresh PAYPAL_SANDBOX workspace.",
);
let context, page, shot;
async function startShot(id, title) {
  context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: resolve(output, "raw"),
      size: { width: 1920, height: 1080 },
    },
    storageState: auth,
    baseURL: base,
  });
  page = await context.newPage();
  shot = {
    id,
    title,
    startedAt: new Date().toISOString(),
    startedMs: Date.now(),
    moments: [],
  };
  console.log("SHOT_STARTED: " + id + " " + title);
}
function mark(label) {
  shot.moments.push({ label, seconds: (Date.now() - shot.startedMs) / 1000 });
}
async function hold(ms) {
  await delay(ms);
}
async function finishShot() {
  mark("end");
  await page.screenshot({
    path: resolve(output, shot.id + "-final.png"),
    fullPage: false,
  });
  auth = await context.storageState();
  const v = page.video();
  await context.close();
  shot.rawVideo = await v.path();
  shot.finishedAt = new Date().toISOString();
  delete shot.startedMs;
  shotManifest.shots.push(shot);
  await saveManifest();
}
async function open(path, locator) {
  await page.goto(path);
  if (locator) await locator.waitFor({ state: "visible" });
}
// Look up internal case IDs using the authenticated app, without logging credentials.
const lookup = await browser.newContext({ storageState: auth, baseURL: base });
const rows = await getJSON(lookup, "/api/cases");
const ids = Object.fromEntries(rows.map((r) => [r.display_id, r.id]));
await lookup.close();
await startShot("01", "Three orders and one recall");
await open(
  "/workbench",
  page.getByRole("heading", { name: "Your orders", exact: true }),
);
await page.getByLabel("Search orders").fill("RR-00");
await page.locator(".workbench").scrollIntoViewIfNeeded();
mark("workbench");
await hold(5000);
for (const id of ["RR-001", "RR-002", "RR-003"]) {
  await page.getByRole("button", { name: id, exact: true }).click();
  await page
    .getByRole("complementary", { name: "Case evidence and action" })
    .getByRole("heading", { name: id, exact: true })
    .waitFor();
  mark(id);
  await hold(3500);
}
await finishShot();
await startShot("02", "Product and intended audience");
await open("/product", page.getByRole("heading", { name: /A product recall/ }));
mark("product");
await hold(13000);
await finishShot();
await startShot("03", "Real source extraction and human review");
await open(
  "/sources",
  page.getByRole("heading", { name: "Supported product facts", exact: true }),
);
mark("candidate");
await page.getByText("AI extraction details", { exact: true }).click();
await hold(4500);
await page
  .locator(".source-quote")
  .filter({ hasText: "Model number “PB0003”" })
  .scrollIntoViewIfNeeded();
mark("model-evidence");
await hold(5000);
const note =
  "The notice description explicitly names Belkin PB0003. The model-specific paragraph states that all PB0003 serial numbers are included. The caption PB003 remains a discrepancy and is not an alias. This rule covers only exact Belkin PB0003; MMA008 and BPB002 serial constraints remain outside this v1 rule.";
await page
  .getByRole("button", { name: "Review this rule again", exact: true })
  .click()
  .catch(() => {});
await page.getByLabel("Resolve the caption/body discrepancy").fill(note);
await page
  .getByLabel(
    "I reviewed the source context and approve only this exact PB0003 scope.",
  )
  .scrollIntoViewIfNeeded();
mark("rule-review-ready");
console.log(
  "MANUAL_RULE_REVIEW_READY: Review the exact PB0003 evidence, tick the source-review checkbox, and click Approve reviewed rule (or Save a new reviewed rule). This is being recorded; no payment is authorized by rule review.",
);
await waitFor(
  context,
  async () => {
    const s = await getJSON(context, "/api/sources");
    return s.extraction_id === state.extractionId && s.rule_revision >= 2;
  },
  "RULE_REVIEW",
);
mark("rule-approved");
shotManifest.gates.push({
  type: "HUMAN_RULE_APPROVAL",
  at: new Date().toISOString(),
});
await hold(4000);
await finishShot();
await startShot("04", "Exact near-match and missing evidence");
for (const [id, ms] of [
  ["RR-001", 7500],
  ["RR-002", 7500],
  ["RR-003", 7500],
]) {
  await open(
    "/cases/" + ids[id],
    page.getByRole("heading", { name: id, exact: true }),
  );
  await page.getByText("Official source evidence", { exact: true }).waitFor();
  mark(id);
  await hold(ms);
  if (id !== "RR-001") {
    await page
      .getByRole("button", { name: "Review courtesy refund", exact: true })
      .scrollIntoViewIfNeeded();
    mark(id + "-blocked");
    await hold(3500);
  }
}
await finishShot();
await startShot("05", "Separate policy and deliberate PayPal refund");
await open(
  "/cases/" + ids["RR-001"],
  page.getByRole("heading", { name: "RR-001", exact: true }),
);
await page
  .getByText("Official manufacturer remedy", { exact: true })
  .scrollIntoViewIfNeeded();
mark("manufacturer-remedy");
await hold(5500);
await page
  .getByRole("button", { name: "Review courtesy refund", exact: true })
  .scrollIntoViewIfNeeded();
mark("merchant-policy");
await hold(4000);
await page
  .getByRole("button", { name: "Review courtesy refund", exact: true })
  .click();
await page
  .getByRole("heading", {
    name: "Review courtesy refund approval",
    exact: true,
  })
  .waitFor();
await page.locator(".approval-box").scrollIntoViewIfNeeded();
mark("refund-review-ready");
console.log(
  "MANUAL_REFUND_APPROVAL_READY: Review the USD 49.00 proposal and capture, tick the approval checkbox, and click Approve courtesy refund. This is the actual sandbox refund being recorded.",
);
await waitFor(
  context,
  async () => {
    const c = await getJSON(context, "/api/cases/" + ids["RR-001"]);
    return !!c.attempt_id;
  },
  "REFUND_APPROVAL",
);
mark("refund-approved");
let attempt;
await waitFor(
  context,
  async () => {
    const c = await getJSON(context, "/api/cases/" + ids["RR-001"]);
    attempt = await getJSON(context, "/api/attempts/" + c.attempt_id);
    return [
      "COMPLETED",
      "OUTCOME_UNKNOWN",
      "FAILED_FINAL",
      "CANCELLED_FINAL",
      "BLOCKED_BEFORE_DISPATCH",
    ].includes(attempt.status);
  },
  "REFUND_RESULT",
);
if (attempt.status !== "COMPLETED") {
  console.log(
    "REFUND_REQUIRES_INSPECTION: " +
      attempt.status +
      ". The same attempt is preserved; no automatic POST retry.",
  );
  await page
    .getByRole("button", { name: "Refresh verified status", exact: true })
    .click();
  await waitFor(
    context,
    async () => {
      attempt = await getJSON(context, "/api/attempts/" + attempt.id);
      return attempt.status === "COMPLETED";
    },
    "REFUND_GET_VERIFICATION",
  );
}
await page
  .getByRole("heading", { name: "Courtesy refund completed", exact: true })
  .waitFor({ timeout: 20000 });
await page
  .getByText("Refund identifiers & verification", { exact: true })
  .click();
await page.locator(".receipt-block").scrollIntoViewIfNeeded();
mark("refund-completed");
shotManifest.gates.push({
  type: "VERIFIED_SANDBOX_REFUND",
  at: new Date().toISOString(),
  attemptId: attempt.id,
  refundId: attempt.provider_refund_id,
  status: attempt.status,
});
await hold(6500);
await finishShot();
await startShot("06", "Repeat execution returns the same attempt");
await open(
  "/cases/" + ids["RR-001"],
  page.getByRole("heading", { name: "Courtesy refund completed", exact: true }),
);
await page
  .getByText("Refund identifiers & verification", { exact: true })
  .click();
await page.locator(".receipt-block").scrollIntoViewIfNeeded();
mark("before-repeat");
await hold(4000);
await page
  .getByRole("button", { name: "Re-submit this approval", exact: true })
  .click();
await page
  .getByRole("status")
  .filter({ hasText: "Existing attempt returned" })
  .waitFor();
mark("same-attempt");
await hold(11000);
await finishShot();
await startShot("07", "Order investigation with AG Grid");
await open(
  "/workbench",
  page.getByRole("heading", { name: "Your orders", exact: true }),
);
await page.locator(".workbench").scrollIntoViewIfNeeded();
mark("grid");
await hold(4000);
await page.getByLabel("Search orders").fill("PB0004");
mark("search");
await hold(3500);
await page.getByLabel("Search orders").fill("");
await page.getByRole("button", { name: "More filters", exact: true }).click();
await page.getByLabel("Filter payment state").selectOption("COMPLETED");
mark("completed-filter");
await hold(6500);
await finishShot();
await startShot("08", "Closing product identity");
await open("/product", page.getByRole("heading", { name: /A product recall/ }));
mark("closing");
await hold(14000);
await finishShot();
shotManifest.finishedAt = new Date().toISOString();
await saveManifest();
await browser.close();
console.log(
  "RECORDING_FINISHED: All eight real-app scenes captured. Manifest and raw WebM files saved. No narration generated.",
);
