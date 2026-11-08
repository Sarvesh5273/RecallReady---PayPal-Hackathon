import type { MatchState, Policy, Mode } from "./types";
export type EligibilityInput = {
  mode: Mode;
  role: string;
  matchState: MatchState;
  ruleActive: boolean;
  sourceFresh: boolean;
  conflicts: number;
  policyActive: boolean;
  itemCount: number;
  quantity: number;
  taxMinor: string;
  shippingMinor: string;
  discountMinor: string;
  currency: string;
  orderMinor: string;
  captureMinor: string;
  owned: boolean;
  merchantMatches: boolean;
  captureStatus: string;
  priorRefund: boolean;
  hasAttempt?: boolean;
};
export function eligibility(
  input: EligibilityInput,
  policy: Policy,
): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!["OWNER", "OPERATOR"].includes(input.role))
    reasons.push("PERMISSION_REQUIRED");
  if (input.matchState === "NEEDS_REVIEW") reasons.push("MATCH_UNCERTAIN");
  if (input.matchState === "NOT_MATCHED_TO_NOTICE") reasons.push("NOT_MATCHED");
  if (!input.ruleActive || input.conflicts) reasons.push("RULE_UNREVIEWED");
  if (!input.sourceFresh) reasons.push("SOURCE_STALE");
  if (!input.policyActive) reasons.push("POLICY_REVOKED");
  if (
    input.itemCount !== 1 ||
    input.quantity !== 1 ||
    input.taxMinor !== "0" ||
    input.shippingMinor !== "0" ||
    input.discountMinor !== "0"
  )
    reasons.push("UNSUPPORTED_ORDER");
  if (input.currency !== "USD") reasons.push("UNSUPPORTED_CURRENCY");
  if (
    !/^\d+$/.test(input.captureMinor) ||
    BigInt(input.captureMinor) <= 0n ||
    BigInt(input.captureMinor) > BigInt(policy.maxCaptureMinor)
  )
    reasons.push("UNSUPPORTED_AMOUNT");
  if (input.orderMinor !== input.captureMinor)
    reasons.push("PAYMENT_STATE_CHANGED");
  if (!input.owned || !input.merchantMatches) reasons.push("PAYMENT_NOT_OWNED");
  if (input.captureStatus !== "COMPLETED" || input.priorRefund)
    reasons.push("PAYMENT_STATE_CHANGED");
  if (input.hasAttempt) reasons.push("ATTEMPT_EXISTS");
  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)] };
}
