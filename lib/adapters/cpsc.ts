import { z } from "zod";
import { fetchOfficial, officialURL, parseOfficialPage } from "./official-page";
import { fingerprint, sha256 } from "../domain/approvals";
export function recallDigits(value: string) {
  if (!/^\d{2}-?\d{3}$/.test(value)) throw new Error("INVALID_RECALL_NUMBER");
  return value.replace("-", "");
}
const apiRow = z
  .object({
    RecallNumber: z.string(),
    URL: z.string(),
    RecallDate: z.string().optional(),
    Title: z.string().optional(),
    Products: z
      .array(
        z
          .object({
            Name: z.string().optional(),
            Model: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .optional(),
    Remedies: z
      .array(z.object({ Name: z.string().optional() }).passthrough())
      .optional(),
    RemedyOptions: z
      .array(z.object({ Option: z.string().optional() }).passthrough())
      .optional(),
  })
  .passthrough();
export async function fetchRecall(value: string) {
  const digits = recallDigits(value);
  const rawJson = await fetchOfficial(
    `https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallNumber=${encodeURIComponent(digits)}`,
    true,
  );
  const raw = z.array(apiRow).parse(JSON.parse(rawJson));
  const exact = raw.filter((x) => x.RecallNumber.replace(/\D/g, "") === digits);
  if (exact.length !== 1) throw new Error("SOURCE_EXACT_RECORD_REQUIRED");
  const record = exact[0],
    url = officialURL(record.URL).href;
  const html = await fetchOfficial(url);
  const text = parseOfficialPage(html);
  const documents = [
    { id: "notice", text, hash: sha256(text) },
    {
      id: "api",
      text: JSON.stringify(record, null, 2).normalize("NFC"),
      hash: sha256(JSON.stringify(record, null, 2).normalize("NFC")),
    },
  ];
  return {
    digits,
    url,
    raw: record,
    html,
    documents,
    hash: fingerprint({ record, text }).hash,
    sourceDate: record.RecallDate?.slice(0, 10) ?? "UNKNOWN",
    fetchedAt: new Date(),
  };
}
