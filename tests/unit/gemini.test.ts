import { afterEach, describe, it, expect, vi } from "vitest";
import { extractSource, extractionConfig } from "../../lib/adapters/extraction";
import { GEMINI_RESPONSE_SCHEMA } from "../../lib/adapters/gemini";
import { fixtureCandidate, fixtureDocs } from "../../lib/adapters/fixtures";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function mockGemini(
  candidate: unknown = fixtureCandidate,
  finishReason = "STOP",
  modelVersion = "gemini-3.8-flash",
) {
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("GEMINI_API_KEY", "unit-test-gemini-key");
  vi.stubEnv("GEMINI_MODEL", "gemini-3.8-flash");
  const fn = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        responseId: "unit-test-gemini-response",
        modelVersion,
        candidates: [
          {
            finishReason,
            content: { parts: [{ text: JSON.stringify(candidate) }] },
          },
        ],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}
describe("Gemini extraction boundary", () => {
  it("uses a supported single-value enum for the schema version and rejects another version", async () => {
    expect(
      (GEMINI_RESPONSE_SCHEMA.properties!.schemaVersion as { enum: string[] })
        .enum,
    ).toEqual(["1"]);
    mockGemini({ ...fixtureCandidate, schemaVersion: "1.0" });
    await expect(extractSource(fixtureDocs)).rejects.toMatchObject({
      code: "AI_EVIDENCE_INVALID",
      issuePaths: ["schemaVersion"],
    });
  });
  it("uses fixed HTTPS endpoint and secret header; validates source evidence", async () => {
    const fn = mockGemini();
    const result = await extractSource(fixtureDocs);
    expect(result.provider).toBe("GEMINI");
    expect(result.responseId).toBe("unit-test-gemini-response");
    const [url, options] = fn.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    );
    expect(url).not.toContain("unit-test-gemini-key");
    const body = JSON.parse(options.body);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.tools).toBeUndefined();
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("low");
    expect(options.body).not.toContain("unit-test-gemini-key");
    expect(options.redirect).toBe("error");
  });
  it("cannot approve money movement", async () => {
    mockGemini({ ...fixtureCandidate, approveRefund: true });
    await expect(extractSource(fixtureDocs)).rejects.toMatchObject({
      code: "AI_EVIDENCE_INVALID",
    });
  });
  it("rejects constrained serial model incorrectly declared as all serials", async () => {
    const c = structuredClone(fixtureCandidate);
    c.products[0].model.value = "MMA008";
    c.products[0].model.evidence = fixtureCandidate.products[0].model.evidence;
    mockGemini(c);
    await expect(extractSource(fixtureDocs)).rejects.toMatchObject({
      code: "AI_EVIDENCE_INVALID",
    });
  });
  it("rejects missing model conflict", async () => {
    mockGemini({ ...fixtureCandidate, conflicts: [] });
    await expect(extractSource(fixtureDocs)).rejects.toMatchObject({
      code: "AI_EVIDENCE_INVALID",
    });
  });
  it("rejects joined passages even when both facts are present in the source", async () => {
    const candidate = structuredClone(fixtureCandidate);
    candidate.products[0].model.evidence[0].quote +=
      " . . Recalled PB003 Portable Power Bank";
    mockGemini(candidate);
    await expect(extractSource(fixtureDocs)).rejects.toMatchObject({
      code: "AI_EVIDENCE_INVALID",
      diagnostic: "QUOTE_NOT_FOUND",
    });
  });
  it("rejects truncated generation", async () => {
    mockGemini(fixtureCandidate, "MAX_TOKENS");
    await expect(extractSource(fixtureDocs)).rejects.toMatchObject({
      code: "AI_NOT_COMPLETED",
    });
  });
  it("preserves the actual model version", async () => {
    mockGemini(fixtureCandidate, "STOP", "gemini-3.8-flash-001");
    expect((await extractSource(fixtureDocs)).model).toBe(
      "gemini-3.8-flash-001",
    );
  });
  it("rejects an unrelated model version", async () => {
    mockGemini(fixtureCandidate, "STOP", "other-model");
    await expect(extractSource(fixtureDocs)).rejects.toMatchObject({
      code: "AI_MODEL_MISMATCH",
    });
  });
  it("redacts provider errors and never falls back or retries", async () => {
    const fn = mockGemini();
    fn.mockResolvedValue(
      new Response("unit-test-secret-provider-message", { status: 403 }),
    );
    const error = await extractSource(fixtureDocs).catch((e) => e);
    expect(error.code).toBe("GEMINI_AUTH_FAILED");
    expect(error.message).not.toContain("unit-test-secret-provider-message");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("does not use a Groq key as a Gemini credential", () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "unit-test-groq-key");
    expect(extractionConfig().configured).toBe(false);
  });
  it("requires the original provider response ID", async () => {
    const fn = mockGemini();
    fn.mockResolvedValue(
      new Response(
        JSON.stringify({
          modelVersion: "gemini-3.8-flash",
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ text: JSON.stringify(fixtureCandidate) }] },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(extractSource(fixtureDocs)).rejects.toMatchObject({
      code: "AI_RESPONSE_INVALID",
    });
  });
});
