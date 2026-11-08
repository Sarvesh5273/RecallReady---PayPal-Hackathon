import { mkdir, writeFile } from "node:fs/promises";
import { ledger, fixtureRule } from "../lib/adapters/fixtures";
import { matchProduct } from "../lib/domain/matching";
async function main() {
  const results = ledger.map((c) => ({
    case: c.id,
    expected: c.expectedMatch,
    actual: matchProduct(c, fixtureRule).state,
  }));
  const passed = results.filter((c) => c.expected === c.actual).length;
  const report = {
    kind: "DETERMINISTIC_MATCHER_ONLY",
    generatedAt: new Date().toISOString(),
    passed,
    total: results.length,
    notMeasured: [
      "AI extraction accuracy",
      "provider execution",
      "concurrency",
      "merchant validation",
    ],
    results,
  };
  await mkdir("docs/reports", { recursive: true });
  await writeFile(
    "docs/reports/matching.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `${passed}/${results.length} deterministic matcher cases passed. Not an AI accuracy metric.`,
  );
  if (passed !== results.length) process.exitCode = 1;
}
main();
