import { afterEach, describe, it, expect, vi } from "vitest";
import { GROQ_RESPONSE_SCHEMA } from "../../lib/adapters/groq";
import { extractionConfig, extractSource } from "../../lib/adapters/extraction";
import { fixtureCandidate, fixtureDocs } from "../../lib/adapters/fixtures";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function mockGroq(
  candidate: unknown = fixtureCandidate,
  finish = "stop",
  model = "openai/gpt-oss-120b",
) {
  vi.stubEnv("GROQ_API_KEY", "unit-test-key");
  vi.stubEnv("GROQ_MODEL", "openai/gpt-oss-120b");
  vi.stubEnv("AI_PROVIDER", "groq");
  const fn = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        id: "unit-test-response",
        model,
        choices: [
          {
            finish_reason: finish,
            message: { content: JSON.stringify(candidate) },
          },
        ],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}
describe("Groq extraction boundary", () => {
  it("sends strict schema to the fixed Groq host and retains validated evidence", async () => {
    const fetcher = mockGroq();
    const result = await extractSource(fixtureDocs);
    expect(result.provider).toBe("GROQ");
    expect(result.responseId).toBe("unit-test-response");
    expect(result.candidate.products[0].model.value).toBe("PB0003");
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse(options.body);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.model).toBe("openai/gpt-oss-120b");
    expect(body.tools).toBeUndefined();
    expect(body.reasoning_effort).toBe("low");
    expect(body.include_reasoning).toBe(false);
    expect(body.messages[1].content).not.toContain("unit-test-key");
    expect(options.redirect).toBe("error");
  });
  it("requires every schema field and disallows extra properties recursively", () => {
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const schema = node as Record<string, unknown>;
      if (schema.type === "object") {
        expect(schema.additionalProperties).toBe(false);
        expect(new Set(schema.required as string[])).toEqual(
          new Set(Object.keys(schema.properties as object)),
        );
      }
      Object.values(schema).forEach((v) => {
        if (Array.isArray(v)) v.forEach(walk);
        else walk(v);
      });
    };
    walk(GROQ_RESPONSE_SCHEMA);
  });
  it("cannot grant money permissions", async () => {
    mockGroq({ ...fixtureCandidate, approveRefund: true });
    await expect(extractSource(fixtureDocs)).rejects.toMatchObject({
      code: "AI_EVIDENCE_INVALID",
    });
  });
  it("rejects invented source quotes despite valid JSON", async () => {
    const candidate = structuredClone(fixtureCandidate);
    candidate.products[0].model.evidence[0].quote = "Unsupported quote";
    mockGroq(candidate);
    await expect(extractSource(fixtureDocs)).rejects.toMatchObject({
      code: "AI_EVIDENCE_INVALID",
    });
  });
  it("rejects missing caption conflict", async () => {
    mockGroq({ ...fixtureCandidate, conflicts: [] });
    await expect(extractSource(fixtureDocs)).rejects.toMatchObject({
      code: "AI_EVIDENCE_INVALID",
    });
  });
  it("cannot disguise one model as another", async () => {
    mockGroq(fixtureCandidate, "stop", "other-model");
    await expect(extractSource(fixtureDocs)).rejects.toMatchObject({
      code: "AI_MODEL_MISMATCH",
    });
  });
  it("rejects truncated output", async () => {
    mockGroq(fixtureCandidate, "length");
    await expect(extractSource(fixtureDocs)).rejects.toMatchObject({
      code: "AI_NOT_COMPLETED",
    });
  });
  it("redacts provider errors and never retries or switches provider", async () => {
    const fn = mockGroq();
    fn.mockResolvedValue(
      new Response("unit-test-secret-provider-body", { status: 401 }),
    );
    const error = await extractSource(fixtureDocs).catch((e) => e);
    expect(error.code).toBe("GROQ_AUTH_FAILED");
    expect(error.message).not.toContain("unit-test-secret-provider-body");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("does not use an OpenAI key as a Groq credential", () => {
    vi.stubEnv("AI_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "unit-test-key");
    expect(extractionConfig().configured).toBe(false);
  });
  it("rejects unsupported strict-mode models before network", async () => {
    const fn = mockGroq();
    vi.stubEnv("GROQ_MODEL", "unsupported-model");
    await expect(extractSource(fixtureDocs)).rejects.toMatchObject({
      code: "GROQ_MODEL_UNSUPPORTED",
    });
    expect(fn).not.toHaveBeenCalled();
  });
  it("rejects an oversized source before network", async () => {
    const fn = mockGroq();
    await expect(
      extractSource([{ id: "notice", hash: "x", text: "x".repeat(60001) }]),
    ).rejects.toMatchObject({ code: "SOURCE_TOO_LONG" });
    expect(fn).not.toHaveBeenCalled();
  });
  it("rejects malformed provider JSON without leaking its contents", async () => {
    const fn = mockGroq();
    fn.mockResolvedValue(
      new Response("unit-test-secret-broken-json", { status: 200 }),
    );
    const error = await extractSource(fixtureDocs).catch((e) => e);
    expect(error.code).toBe("AI_RESPONSE_INVALID");
    expect(error.message).not.toContain("unit-test-secret-broken-json");
  });
});
