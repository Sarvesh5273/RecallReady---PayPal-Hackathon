import {
  candidateSchema,
  type Candidate,
  type EvidenceDocument,
  type EvidenceRef,
} from "./types";
import { normalizeIdentity } from "./matching";
export function resolveQuote(
  documents: EvidenceDocument[],
  ref: { documentId: string; quote: string },
): EvidenceRef {
  const doc = documents.find((x) => x.id === ref.documentId);
  if (!doc) throw new Error("Unknown evidence document");
  const start = doc.text.indexOf(ref.quote);
  if (start < 0) throw new Error("Unsupported evidence quote");
  if (doc.text.indexOf(ref.quote, start + 1) >= 0)
    throw new Error("Ambiguous evidence quote: supply more context");
  return {
    ...ref,
    documentHash: doc.hash,
    start,
    end: start + ref.quote.length,
  };
}
export function validateCandidate(
  input: unknown,
  docs: EvidenceDocument[],
): Candidate {
  const candidate = candidateSchema.parse(input);
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    if (
      typeof row.value === "string" &&
      (!Array.isArray(row.evidence) || !row.evidence.length)
    )
      throw new Error("Material fact lacks evidence");
    if (
      typeof row.value === "string" &&
      Array.isArray(row.evidence) &&
      !row.evidence.some((e: unknown) => {
        const ref = e as { quote?: string };
        return (
          typeof ref.quote === "string" &&
          normalizeIdentity(ref.quote).includes(
            normalizeIdentity(row.value as string),
          )
        );
      })
    )
      throw new Error(
        "Fact value is unsupported by its cited evidence; retain source wording.",
      );
    if (typeof row.documentId === "string" && typeof row.quote === "string")
      resolveQuote(docs, { documentId: row.documentId, quote: row.quote });
    Object.values(row).forEach(walk);
  };
  walk(candidate);
  for (const product of candidate.products) {
    for (const f of [product.brand, product.model])
      if (
        f.value &&
        !f.evidence.some((e) =>
          normalizeIdentity(e.quote).includes(normalizeIdentity(f.value)),
        )
      )
        throw new Error("Identity unsupported by evidence");
    if (
      product.serialScope === "ALL_EXPLICIT" &&
      !product.serialConditions.some(
        (c) =>
          c.value &&
          c.evidence.some(
            (e) =>
              /all serial numbers/i.test(e.quote) &&
              product.model.value &&
              e.quote.includes(product.model.value),
          ),
      )
    )
      throw new Error("All-serial scope lacks model-specific context");
  }
  return candidate;
}
export function verifyRefs(refs: EvidenceRef[], docs: EvidenceDocument[]) {
  for (const ref of refs) {
    const actual = resolveQuote(docs, ref);
    if (
      actual.documentHash !== ref.documentHash ||
      actual.start !== ref.start ||
      actual.end !== ref.end
    )
      throw new Error("Evidence offsets or hash changed");
  }
}
