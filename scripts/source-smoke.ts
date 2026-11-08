import { fetchRecall } from "../lib/adapters/cpsc";
import { writeFile, mkdir } from "node:fs/promises";
async function main() {
  const source = await fetchRecall("26090");
  await mkdir("docs/reports", { recursive: true });
  if(process.argv.includes('--save-raw'))await writeFile('fixtures/sources/cpsc-live-snapshot.json',JSON.stringify({canonicalUrl:source.url,sourceDate:source.sourceDate,recallNumber:source.digits,retrievedAt:source.fetchedAt.toISOString(),rawJson:source.raw,rawHtml:source.html,documents:source.documents,hash:source.hash},null,2)+'\n');
  const report = {
    kind: "LIVE_CPSC_READ_ONLY_CHECK",
    checkedAt: source.fetchedAt.toISOString(),
    recallNumber: source.digits,
    url: source.url,
    sourceDate: source.sourceDate,
    hash: source.hash,
    noticeCharacters: source.documents[0].text.length,
    captionConflictPreserved:
      source.documents[0].text.includes("PB003") &&
      source.documents[0].text.includes("PB0003"),
    providerWrites: 0,
  };
  await writeFile(
    "docs/reports/source-live.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(report);
}
main().catch((e) => {
  console.error("Official source check failed:", e.message);
  process.exitCode = 1;
});
