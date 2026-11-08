import excerpt from "../../fixtures/sources/belkin.json";
import rawSnapshot from "../../fixtures/sources/cpsc-live-snapshot.json";
import ledger from "../../fixtures/ledger/cases.json";
import { sha256 } from "../domain/approvals";
import { resolveQuote, validateCandidate } from "../domain/evidence";
import type {
  EvidenceDocument,
  Candidate,
  Policy,
  ProductRule,
} from "../domain/types";
export { ledger };
export const snapshot = {
  ...excerpt,
  retrievedAt: rawSnapshot.retrievedAt,
  rawJson: rawSnapshot.rawJson,
  rawHtml: rawSnapshot.rawHtml,
  provenance:
    "Official CPSC REST/HTML snapshot with a normalized notice excerpt. Cached simulation evidence; not a live workspace freshness check.",
};
const text = snapshot.text.replace(/\r\n/g, "\n").normalize("NFC");
export const fixtureDocs: EvidenceDocument[] = [
  { id: "notice", text, hash: sha256(text) },
];
const description = text.match(
  /This recall involves charging stands[^\n]+/,
)![0];
const modelContext = text.match(/Model number “PB0003”[^\n]+/)![0];
const remedy = text.match(/Consumers should immediately[^\n]+/)![0];
const photo =
  "Consumers should submit photos showing the front and back of the product with their recall submission form.";
const stop =
  "Consumers should immediately stop using the recalled power banks and charging stands and contact Belkin to receive a full refund or store credit.";
const q = (quote: string) => [{ documentId: "notice", quote }];
const f = (value: string, quote = value) => ({ value, evidence: q(quote) });
export const fixtureCandidate: Candidate = validateCandidate(
  {
    schemaVersion: "1",
    recallNumber: f("26-090"),
    recallDate: f("November 13, 2025"),
    products: [
      {
        brand: f("Belkin", stop),
        model: f("PB0003", description),
        serialScope: "ALL_EXPLICIT",
        serialConditions: [f("All serial numbers", modelContext)],
        dateCodeConditions: [],
        otherConditions: [],
      },
    ],
    remedyOptions: [
      {
        kind: "REFUND",
        instructions: f(remedy),
        requirements: [f(photo)],
        contactOrganization: f("Belkin", stop),
      },
      {
        kind: "STORE_CREDIT",
        instructions: f(stop),
        requirements: [f(photo)],
        contactOrganization: f("Belkin", stop),
      },
    ],
    safetyInstructions: [f(stop)],
    conflicts: [
      {
        field: "model",
        description:
          "Image caption PB003 differs from description PB0003. No alias is approved.",
        evidence: [
          ...q("Recalled PB003 Portable Power Bank"),
          ...q(description),
        ],
      },
    ],
    unknowns: ["MMA008 and BPB002 serial rules are not implemented in v1."],
  },
  fixtureDocs,
);
export const fixtureRule: ProductRule = {
  brandExact: "Belkin",
  modelExact: "PB0003",
  serialRule: {
    kind: "ALL_EXPLICIT",
    evidence: [
      resolveQuote(fixtureDocs, { documentId: "notice", quote: modelContext }),
    ],
  },
  allowedDateCodes: null,
  evidence: [
    resolveQuote(fixtureDocs, { documentId: "notice", quote: description }),
  ],
  unresolvedBlockingConflicts: [],
};
export const fixturePolicy: Policy = {
  policyVersion: "courtesy-v1",
  action: "COURTESY_REFUND_FULL_CAPTURE",
  currency: "USD",
  requiresExactReviewedMatch: true,
  requiresHumanApproval: true,
  singleItemOnly: true,
  quantity: 1,
  taxMinor: "0",
  shippingMinor: "0",
  allowPriorRefund: false,
  maxCaptureMinor: "10000",
  requiresFreshSourceHours: 24,
  approvalTtlMinutes: 10,
};
