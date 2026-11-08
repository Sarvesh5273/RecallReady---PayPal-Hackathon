import { z } from "zod";
export const modeSchema = z.enum(["SIMULATION", "PAYPAL_SANDBOX"]);
export type Mode = z.infer<typeof modeSchema>;
export const quoteSchema = z
  .object({ documentId: z.string(), quote: z.string().min(1) })
  .strict();
export const evidenceSchema = quoteSchema
  .extend({
    documentHash: z.string(),
    start: z.number().int(),
    end: z.number().int(),
  })
  .strict();
export type EvidenceRef = z.infer<typeof evidenceSchema>;
export type EvidenceDocument = { id: string; text: string; hash: string };
const fact = z
  .object({ value: z.string().nullable(), evidence: z.array(quoteSchema) })
  .strict();
export const candidateSchema = z
  .object({
    schemaVersion: z.literal("1"),
    recallNumber: fact,
    recallDate: fact,
    products: z.array(
      z
        .object({
          brand: fact,
          model: fact,
          serialScope: z.enum(["ALL_EXPLICIT", "CONSTRAINED", "UNKNOWN"]),
          serialConditions: z.array(fact),
          dateCodeConditions: z.array(fact),
          otherConditions: z.array(fact),
        })
        .strict(),
    ),
    remedyOptions: z.array(
      z
        .object({
          kind: z.enum([
            "REFUND",
            "STORE_CREDIT",
            "REPAIR",
            "REPLACE",
            "OTHER",
            "UNKNOWN",
          ]),
          instructions: fact,
          requirements: z.array(fact),
          contactOrganization: fact,
        })
        .strict(),
    ),
    safetyInstructions: z.array(fact),
    conflicts: z.array(
      z
        .object({
          field: z.string(),
          description: z.string(),
          evidence: z.array(quoteSchema),
        })
        .strict(),
    ),
    unknowns: z.array(z.string()),
  })
  .strict();
export type Candidate = z.infer<typeof candidateSchema>;
export const ruleSchema = z
  .object({
    brandExact: z.string().min(1),
    modelExact: z.string().min(1),
    serialRule: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("ALL_EXPLICIT"),
          evidence: z.array(evidenceSchema).min(1),
        })
        .strict(),
      z
        .object({
          kind: z.literal("PREFIX_SET"),
          prefixes: z.array(z.string().min(1)).min(1),
          requiredLength: z.number().int().positive().nullable(),
          evidence: z.array(evidenceSchema).min(1),
        })
        .strict(),
    ]),
    allowedDateCodes: z.array(z.string()).nullable(),
    evidence: z.array(evidenceSchema).min(1),
    unresolvedBlockingConflicts: z.array(z.string()),
  })
  .strict();
export type ProductRule = z.infer<typeof ruleSchema>;
export type Product = {
  brand: string | null;
  model: string | null;
  serial?: string | null;
  dateCode?: string | null;
};
export type MatchState =
  "EXACT_MATCH" | "NEEDS_REVIEW" | "NOT_MATCHED_TO_NOTICE";
export type MatchResult = {
  state: MatchState;
  reasons: string[];
  evidence: EvidenceRef[];
};
export const statuses = [
  "RESERVED",
  "PREFLIGHT",
  "DISPATCHING",
  "PROVIDER_PENDING",
  "COMPLETED",
  "FAILED_FINAL",
  "CANCELLED_FINAL",
  "OUTCOME_UNKNOWN",
  "BLOCKED_BEFORE_DISPATCH",
] as const;
export type AttemptState = (typeof statuses)[number];
export const policySchema = z
  .object({
    policyVersion: z.literal("courtesy-v1"),
    action: z.literal("COURTESY_REFUND_FULL_CAPTURE"),
    currency: z.literal("USD"),
    requiresExactReviewedMatch: z.literal(true),
    requiresHumanApproval: z.literal(true),
    singleItemOnly: z.literal(true),
    quantity: z.literal(1),
    taxMinor: z.literal("0"),
    shippingMinor: z.literal("0"),
    allowPriorRefund: z.literal(false),
    maxCaptureMinor: z.string().regex(/^[1-9]\d*$/),
    requiresFreshSourceHours: z.number().positive().max(24),
    approvalTtlMinutes: z.number().positive().max(10),
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;
