import { describe, it, expect } from "vitest";
import { normalizeIdentity, matchProduct } from "../../lib/domain/matching";
import {
  fixtureRule,
  fixtureDocs,
  fixtureCandidate,
  fixturePolicy,
  ledger,
} from "../../lib/adapters/fixtures";
import {
  resolveQuote,
  validateCandidate,
  verifyRefs,
} from "../../lib/domain/evidence";
import { fingerprint, canonicalize } from "../../lib/domain/approvals";
import { minorToDecimal, decimalToMinor } from "../../lib/domain/money";
import { refundState, preserveTerminal } from "../../lib/domain/state-machines";
import { eligibility, type EligibilityInput } from "../../lib/domain/policy";
import { guardPayPal } from "../../lib/adapters/paypal";
import {
  officialURL,
  parseOfficialPage,
} from "../../lib/adapters/official-page";
describe("versioned matcher evaluation", () => {
  it.each(ledger)("$id → $expectedMatch", (entry) => {
    expect(matchProduct(entry, fixtureRule).state).toBe(entry.expectedMatch);
  });
});
describe("identity and constraints", () => {
  it("U-01 preserves leading zeros and punctuation", () => {
    expect(normalizeIdentity("PB003")).not.toBe(normalizeIdentity("PB0003"));
    expect(normalizeIdentity("PB-0003")).toBe("PB-0003");
  });
  it("U-02 accepts trim and case", () =>
    expect(
      matchProduct({ brand: " belkin ", model: " pb0003 " }, fixtureRule).state,
    ).toBe("EXACT_MATCH"));
  it("U-07 requires constrained serial evidence", () => {
    const rule = {
      ...fixtureRule,
      serialRule: {
        kind: "PREFIX_SET" as const,
        prefixes: ["35S"],
        requiredLength: 14,
        evidence: fixtureRule.evidence,
      },
    };
    expect(matchProduct({ brand: "Belkin", model: "PB0003" }, rule).state).toBe(
      "NEEDS_REVIEW",
    );
    expect(
      matchProduct({ brand: "Belkin", model: "PB0003", serial: "WRONG" }, rule)
        .state,
    ).toBe("NOT_MATCHED_TO_NOTICE");
  });
  it("blocks an unresolved rule conflict", () =>
    expect(
      matchProduct(
        { brand: "Belkin", model: "PB0003" },
        { ...fixtureRule, unresolvedBlockingConflicts: ["caption conflict"] },
      ).state,
    ).toBe("NEEDS_REVIEW"));
  it("requires explicit date constraint", () =>
    expect(
      matchProduct(
        { brand: "Belkin", model: "PB0003" },
        { ...fixtureRule, allowedDateCodes: ["A"] },
      ).state,
    ).toBe("NEEDS_REVIEW"));
});
describe("source evidence", () => {
  it("U-08 rejects invented quotes", () =>
    expect(() =>
      resolveQuote(fixtureDocs, { documentId: "notice", quote: "invented" }),
    ).toThrow());
  it("U-09 rejects ambiguous offsets", () =>
    expect(() =>
      resolveQuote([{ id: "x", hash: "h", text: "repeat and repeat" }], {
        documentId: "x",
        quote: "repeat",
      }),
    ).toThrow("Ambiguous"));
  it("validates UTF-16 offsets and NFC", () => {
    const ref = resolveQuote([{ id: "x", hash: "h", text: "😀 PB0003" }], {
      documentId: "x",
      quote: "PB0003",
    });
    expect(ref.start).toBe(3);
    verifyRefs([ref], [{ id: "x", hash: "h", text: "😀 PB0003" }]);
  });
  it("U-10 preserves caption conflict", () =>
    expect(fixtureCandidate.conflicts[0].description).toContain("PB003"));
  it("rejects unsupported model identity", () => {
    const c = structuredClone(fixtureCandidate);
    c.products[0].model.value = "PB003";
    expect(() => validateCandidate(c, fixtureDocs)).toThrow("unsupported");
  });
  it("rejects model scope without all-serial context", () => {
    const c = structuredClone(fixtureCandidate);
    c.products[0].serialConditions = [];
    expect(() => validateCandidate(c, fixtureDocs)).toThrow("All-serial");
  });
  it("U-18 cannot inject payment permissions", () => {
    expect(() =>
      validateCandidate(
        { ...fixtureCandidate, approveRefund: true },
        fixtureDocs,
      ),
    ).toThrow();
  });
});
describe("money and approvals", () => {
  it("U-11 exact decimal and bigint roundtrip", () => {
    expect(minorToDecimal("4900")).toBe("49.00");
    expect(decimalToMinor("9007199254740993.01")).toBe("900719925474099301");
  });
  it("rejects floats, negative and missing fractions", () => {
    expect(() => decimalToMinor("49.001")).toThrow();
    expect(() => minorToDecimal("-1")).toThrow();
  });
  it("U-14 canonical fingerprint preserves array order", () => {
    expect(fingerprint({ b: 1, a: { c: 3, d: 4 } })).toEqual(
      fingerprint({ a: { d: 4, c: 3 }, b: 1 }),
    );
    expect(fingerprint([1, 2]).hash).not.toBe(fingerprint([2, 1]).hash);
    expect(() => canonicalize({ a: undefined })).toThrow();
    expect(() => canonicalize(NaN)).toThrow();
  });
  it("U-15 bound changes alter approval", () =>
    expect(fingerprint({ source: 1, minor: "4900" }).hash).not.toBe(
      fingerprint({ source: 2, minor: "4900" }).hash,
    ));
  it("U-16 PENDING never becomes completed", () => {
    expect(refundState("PENDING")).toBe("PROVIDER_PENDING");
    expect(refundState("ALIEN")).toBe("OUTCOME_UNKNOWN");
  });
  it("out-of-order event cannot downgrade completion", () =>
    expect(preserveTerminal("COMPLETED", "PROVIDER_PENDING")).toBe(
      "COMPLETED",
    ));
});
const valid: EligibilityInput = {
  mode: "SIMULATION",
  role: "OPERATOR",
  matchState: "EXACT_MATCH",
  ruleActive: true,
  sourceFresh: true,
  conflicts: 0,
  policyActive: true,
  itemCount: 1,
  quantity: 1,
  taxMinor: "0",
  shippingMinor: "0",
  discountMinor: "0",
  currency: "USD",
  orderMinor: "4900",
  captureMinor: "4900",
  owned: true,
  merchantMatches: true,
  captureStatus: "COMPLETED",
  priorRefund: false,
};
describe("separate merchant authority", () => {
  it("exact match alone is not authority", () =>
    expect(
      eligibility({ ...valid, owned: false }, fixturePolicy).reasons,
    ).toContain("PAYMENT_NOT_OWNED"));
  it.each([
    { captureMinor: "0" },
    { captureMinor: "-1" },
    { currency: "EUR" },
    { itemCount: 2 },
    { quantity: 2 },
    { taxMinor: "100" },
    { shippingMinor: "10" },
    { discountMinor: "100" },
    { captureStatus: "PENDING" },
    { sourceFresh: false },
    { ruleActive: false },
    { policyActive: false },
    { matchState: "NEEDS_REVIEW" as const },
    { role: "VIEWER" },
    { hasAttempt: true },
    { orderMinor: "5000" },
    { captureMinor: "10001" },
  ])("fails closed for %j", (change) =>
    expect(eligibility({ ...valid, ...change }, fixturePolicy).eligible).toBe(
      false,
    ),
  );
});
describe("external adapter boundaries", () => {
  it("I-16 simulation cannot access live adapter", () =>
    expect(() => guardPayPal("SIMULATION")).toThrow("Only"));
  it("rejects live host", () => {
    const prev = process.env.PAYPAL_BASE_URL;
    process.env.PAYPAL_BASE_URL = "https://api-m.paypal.com";
    expect(() => guardPayPal("PAYPAL_SANDBOX")).toThrow();
    process.env.PAYPAL_BASE_URL = prev;
  });
  it.each([
    "http://www.cpsc.gov/Recalls/x",
    "https://127.0.0.1/Recalls/x",
    "https://www.cpsc.gov.evil.test/Recalls/x",
    "https://www.cpsc.gov@evil.test/Recalls/x",
    "https://www.cpsc.gov:8443/Recalls/x",
  ])("blocks unsafe source URL %s", (url) =>
    expect(() => officialURL(url)).toThrow(),
  );
  it("parses only article, preserving caption conflict", () => {
    const text = parseOfficialPage(
      "<nav>ignore source</nav><article><h1>Recall notice</h1><p>" +
        fixtureDocs[0].text +
        '</p><img alt="Recalled PB003 Portable Power Bank"/></article>',
    );
    expect(text).toContain("PB0003");
    expect(text).toContain("PB003");
    expect(text).not.toContain("ignore source");
  });
  it("rejects an empty article", () =>
    expect(() =>
      parseOfficialPage("<html><nav>PB0003</nav></html>"),
    ).toThrow());
});
