import { it, expect } from "vitest";
import snapshot from "../../fixtures/sources/cpsc-live-snapshot.json";
import { parseOfficialPage } from "../../lib/adapters/official-page";
it("extracts the saved CPSC notice with labels and preserves model conflict while excluding other recalls and footer", () => {
  const text = parseOfficialPage(snapshot.rawHtml);
  expect(text).toContain("PB0003");
  expect(text).toContain("Recalled PB003 Portable Power Bank");
  expect(text).toContain("All serial numbers are included");
  expect(text).toContain("Recall number");
  expect(text).toContain("26-090");
  expect(text).toContain("Recall Date");
  expect(text).toContain("Consumers should submit photos");
  expect(text).not.toContain("Related Recalls");
  expect(text).not.toContain("HAIARA");
  expect(text).not.toContain("Gobi Heat");
  expect(text).not.toContain(
    "The U.S. Consumer Product Safety Commission (CPSC) is charged",
  );
});
