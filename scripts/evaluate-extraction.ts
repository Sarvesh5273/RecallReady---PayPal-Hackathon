import { mkdir, writeFile } from "node:fs/promises";
import { fixtureDocs, fixtureCandidate } from "../lib/adapters/fixtures";
import { validateCandidate } from "../lib/domain/evidence";
import { extractSource, extractionConfig } from "../lib/adapters/extraction";
import { BusinessError } from "../lib/errors";
import { ExtractionValidationError } from "../lib/adapters/extraction-contract";
async function main() {
  const live = process.argv.includes("--live");
  if (live && !extractionConfig().configured)
    throw new BusinessError(
      "AI_NOT_CONFIGURED",
      "Configure the selected AI provider.",
      503,
    );
  const extraction = live ? await extractSource(fixtureDocs) : null;
  if (extraction) {
    await mkdir("docs/reports", { recursive: true });
    await writeFile(
      "docs/reports/live-extraction-candidate.json",
      JSON.stringify(
        {
          provider: extraction.provider,
          model: extraction.model,
          responseId: extraction.responseId,
          documents: fixtureDocs,
          candidate: extraction.candidate,
        },
        null,
        2,
      ) + "\n",
    );
  }
  const candidate = extraction?.candidate ?? fixtureCandidate;
  const cases = [
    { name: "official cached notice", candidate, pass: true },
    {
      name: "synthetic unsupported quote",
      candidate: {
        ...candidate,
        recallNumber: {
          value: "26-090",
          evidence: [{ documentId: "notice", quote: "Invented source quote" }],
        },
      },
      pass: false,
    },
    {
      name: "synthetic missing model scope",
      candidate: {
        ...candidate,
        products: candidate.products.map((p) =>
          p.model.value === "PB0003" ? { ...p, serialConditions: [] } : p,
        ),
      },
      pass: false,
    },
    {
      name: "synthetic payment injection",
      candidate: { ...candidate, approveRefund: true },
      pass: false,
    },
  ];
  const results = cases.map((c) => {
    let accepted = true;
    try {
      validateCandidate(c.candidate, fixtureDocs);
    } catch {
      accepted = false;
    }
    return {
      name: c.name,
      expectedAcceptance: c.pass,
      accepted,
      passed: accepted === c.pass,
    };
  });
  const report = {
    kind: live
      ? `LIVE_${extraction!.provider}_EXTRACTION`
      : "FIXTURE_VALIDATOR_EVALUATION",
    generatedAt: new Date().toISOString(),
    modelCalls: live ? 1 : 0,
    provider: extraction?.provider ?? "FIXTURE",
    model: extraction?.model ?? "FIXTURE_NO_MODEL_CALL",
    responseId: extraction?.responseId ?? null,
    results,
    limitations:
      "Fixture validation tests do not measure model extraction quality. Live evaluation uses a cached official source. No money movement.",
  };
  await mkdir("docs/reports", { recursive: true });
  await writeFile(
    "docs/reports/extraction.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
  if (results.some((c) => !c.passed)) process.exitCode = 1;
}
main().catch(async (error) => {
  if (error instanceof ExtractionValidationError) {
    await mkdir("docs/reports", { recursive: true });
    await writeFile(
      "docs/reports/rejected-ai-candidate.json",
      JSON.stringify(
        {
          candidate: error.candidate,
          diagnostic: error.diagnostic,
          issuePaths: error.issuePaths,
          model: error.model,
          responseId: error.responseId,
        },
        null,
        2,
      ) + "\n",
    );
    console.error(
      JSON.stringify({
        diagnostic: error.diagnostic,
        issuePaths: error.issuePaths,
      }),
    );
  }
  console.error(
    error instanceof BusinessError
      ? `${error.code}: ${error.message}`
      : "AI_EXTRACTION_FAILED: Extraction evaluation unavailable.",
  );
  process.exitCode = 1;
});
