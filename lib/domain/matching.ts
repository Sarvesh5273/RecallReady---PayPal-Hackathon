import type { Product, ProductRule, MatchResult, MatchState } from "./types";
export function normalizeIdentity(value: string | null | undefined) {
  return value?.normalize("NFC").trim().toUpperCase() ?? "";
}
export function matchProduct(product: Product, rule: ProductRule): MatchResult {
  const reasons: string[] = [];
  const result = (state: MatchState): MatchResult => ({
    state,
    reasons,
    evidence: rule.evidence,
  });
  const brand = normalizeIdentity(product.brand),
    model = normalizeIdentity(product.model);
  if (!brand) reasons.push("MISSING_BRAND");
  if (!model) reasons.push("MISSING_MODEL");
  if (!brand || !model) return result("NEEDS_REVIEW");
  if (brand !== normalizeIdentity(rule.brandExact)) {
    reasons.push("BRAND_DIFFERS");
    return result("NOT_MATCHED_TO_NOTICE");
  }
  reasons.push("BRAND_EXACT");
  if (rule.unresolvedBlockingConflicts.length) {
    reasons.push("RULE_CONFLICT");
    return result("NEEDS_REVIEW");
  }
  if (model === "PB003" && normalizeIdentity(rule.modelExact) === "PB0003") {
    reasons.push("UNRESOLVED_ALIAS");
    return result("NEEDS_REVIEW");
  }
  if (model !== normalizeIdentity(rule.modelExact)) {
    if (["BPB002", "MMA008"].includes(model)) {
      reasons.push("UNSUPPORTED_NOTICE_RULE");
      return result("NEEDS_REVIEW");
    }
    reasons.push("MODEL_DIFFERS");
    return result("NOT_MATCHED_TO_NOTICE");
  }
  reasons.push("MODEL_EXACT");
  if (rule.serialRule.kind === "PREFIX_SET") {
    const serial = normalizeIdentity(product.serial);
    if (!serial) {
      reasons.push("MISSING_SERIAL");
      return result("NEEDS_REVIEW");
    }
    if (
      (rule.serialRule.requiredLength !== null &&
        serial.length !== rule.serialRule.requiredLength) ||
      !rule.serialRule.prefixes.some((p) => serial.startsWith(p))
    ) {
      reasons.push("SERIAL_OUTSIDE_SCOPE");
      return result("NOT_MATCHED_TO_NOTICE");
    }
    reasons.push("SERIAL_IN_SCOPE");
  } else reasons.push("ALL_SERIALS_EXPLICIT");
  if (rule.allowedDateCodes) {
    if (!product.dateCode) {
      reasons.push("MISSING_DATE_CODE");
      return result("NEEDS_REVIEW");
    }
    if (!rule.allowedDateCodes.includes(product.dateCode)) {
      reasons.push("DATE_OUTSIDE_SCOPE");
      return result("NOT_MATCHED_TO_NOTICE");
    }
    reasons.push("DATE_IN_SCOPE");
  }
  return result("EXACT_MATCH");
}
