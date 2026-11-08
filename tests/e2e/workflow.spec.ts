import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open isolated simulation" }).click();
  await expect(page).toHaveURL(/workbench/);
});
test("E-01 approval, simulated receipt, and repeated execution return the same attempt", async ({
  page,
}) => {
  await expect(page.getByText("SIMULATION", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Review courtesy refund", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve courtesy refund" }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "I reviewed the evidence, merchant basis, and exact amount.",
    })
    .check();
  await page.getByRole("button", { name: "Approve courtesy refund" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Courtesy refund completed",
      exact: true,
    }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Re-submit this approval" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Existing attempt returned" }),
  ).toBeVisible();
  await expect(
    page.getByText("No manufacturer claim has been submitted by RecallReady."),
  ).toBeVisible();
});
test("E-02 missing identifier and near-match disable financial action", async ({
  page,
}) => {
  await page.getByRole("button", { name: "RR-003", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review courtesy refund", exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("complementary", { name: "Case evidence and action" })
      .getByText(
        "Model identifier is missing. A product title cannot establish a match.",
        { exact: true },
      ),
  ).toBeVisible();
  await page.getByRole("button", { name: "RR-002", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review courtesy refund", exact: true }),
  ).toBeDisabled();
});
test("E-04 timeout shows unknown and offers reconciliation only", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Guided walkthrough" }).click();
  await page.getByRole("button", { name: "4. RR-021" }).click();
  await page
    .getByRole("button", { name: "Review courtesy refund", exact: true })
    .click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Approve courtesy refund" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Outcome unknown: reconciliation required",
    }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByRole("button", { name: "Refresh verified status" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Re-submit this approval" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Existing attempt returned" }),
  ).toBeVisible();
});
test("E-06 tenant isolation and browser amount rejection", async ({
  page,
  browser,
}) => {
  await expect(
    page.getByRole("complementary", { name: "Case evidence and action" }),
  ).toBeAttached();
  const data = await page.evaluate(async () => ({
    cases: await (await fetch("/api/cases")).json(),
    csrf: document.cookie
      .split("; ")
      .find((c) => c.startsWith("rr_csrf="))
      ?.split("=")[1],
  }));
  const exact = data.cases.find(
    (c: { display_id: string }) => c.display_id === "RR-001",
  );
  const response = await page.request.post(`/api/cases/${exact.id}/proposal`, {
    headers: { Origin: "http://localhost:3000", "x-csrf-token": data.csrf! },
    data: { amountMinor: "1" },
  });
  expect(response.status()).toBe(400);
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto("/");
  await otherPage
    .getByRole("button", { name: "Open isolated simulation" })
    .click();
  await expect(otherPage).toHaveURL(/workbench/);
  const foreign = await other.request.get(
    "http://localhost:3000/api/cases/" + exact.id,
  );
  expect(foreign.status()).toBe(404);
  await other.close();
});
test("E-07 mobile detail preserves source and decision", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: /RR-001/ }).click();
  await expect(page).toHaveURL(/cases\//);
  await expect(
    page.getByText("Official source evidence", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review courtesy refund", exact: true }),
  ).toBeVisible();
});
test("E-05 keyboard review and approval work", async ({ page }) => {
  const review = page.getByRole("button", {
    name: "Review courtesy refund",
    exact: true,
  });
  await review.focus();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("checkbox", {
    name: "I reviewed the evidence, merchant basis, and exact amount.",
  });
  await confirm.focus();
  await page.keyboard.press("Space");
  const approve = page.getByRole("button", { name: "Approve courtesy refund" });
  await approve.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", {
      name: "Courtesy refund completed",
      exact: true,
    }),
  ).toBeVisible({ timeout: 20000 });
});
