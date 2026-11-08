import "dotenv/config";
import { GROQ_RESPONSE_SCHEMA, groqModel } from "../lib/adapters/groq";
import {
  EXTRACTION_PROMPT,
  boundDocuments,
  GROQ_EXTRACTION_GUIDANCE,
  validateExtraction,
} from "../lib/adapters/extraction-contract";
import { fixtureDocs } from "../lib/adapters/fixtures";
import { mkdir, writeFile } from "node:fs/promises";
import { candidateSchema } from "../lib/domain/types";
import { resolveQuote } from "../lib/domain/evidence";
import { normalizeIdentity } from "../lib/domain/matching";
async function main() {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    console.log("GROQ_NOT_CONFIGURED");
    return;
  }
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: groqModel(),
        messages: [
          {
            role: "system",
            content: EXTRACTION_PROMPT + " " + GROQ_EXTRACTION_GUIDANCE,
          },
          {
            role: "user",
            content: JSON.stringify(boundDocuments(fixtureDocs)),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "recall_candidate_v1",
            strict: true,
            schema: GROQ_RESPONSE_SCHEMA,
          },
        },
        temperature: 0.1,
        reasoning_effort: "low",
        include_reasoning: false,
        max_completion_tokens: 10000,
        stream: false,
      }),
    },
  );
  const raw = (await response.json()) as {
    error?: { message?: string; code?: string; type?: string };
    id?: string;
    model?: string;
    choices?: { message: { content: string }; finish_reason: string }[];
  };
  if (response.ok) {
    const candidate = JSON.parse(raw.choices![0].message.content);
    await mkdir("docs/reports", { recursive: true });
    await writeFile(
      "docs/reports/groq-diagnostic-candidate.json",
      JSON.stringify(
        {
          model: raw.model,
          responseId: raw.id,
          candidate,
          documents: fixtureDocs,
        },
        null,
        2,
      ) + "\n",
    );
    const errors: { path: string; reason: string }[] = [];
    const parsed = candidateSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        errors.push({ path: issue.path.join("."), reason: issue.code });
    }
    const walk = (value: unknown, path = "root"): void => {
      if (Array.isArray(value)) {
        value.forEach((x, i) => walk(x, path + "." + i));
        return;
      }
      if (!value || typeof value !== "object") return;
      const row = value as Record<string, unknown>;
      if (
        typeof row.value === "string" &&
        Array.isArray(row.evidence) &&
        !row.evidence.some((e) =>
          normalizeIdentity((e as { quote: string }).quote).includes(
            normalizeIdentity(row.value as string),
          ),
        )
      )
        errors.push({ path, reason: "UNSUPPORTED_VALUE" });
      if (typeof row.documentId === "string" && typeof row.quote === "string") {
        try {
          resolveQuote(fixtureDocs, {
            documentId: row.documentId,
            quote: row.quote,
          });
        } catch (error) {
          errors.push({ path, reason: (error as Error).message });
        }
      }
      Object.entries(row).forEach(([k, v]) => walk(v, path + "." + k));
    };
    walk(candidate);
    let valid = true;
    try {
      validateExtraction(candidate, fixtureDocs);
    } catch {
      valid = false;
    }
    console.log(
      JSON.stringify({
        status: response.status,
        requestAccepted: true,
        valid,
        errors,
        keysDisplayed: false,
      }),
    );
    return;
  }
  // Provider diagnostics only; scrub all credential values locally before output.
  let message = raw.error?.message ?? "Unspecified provider rejection";
  for (const [name, value] of Object.entries(process.env))
    if (
      value &&
      /KEY|SECRET|PASSWORD|TOKEN|CLIENT_ID|DATABASE|MERCHANT_ID/i.test(name)
    )
      message = message.split(value).join("[REDACTED]");
  message = message.replace(/[A-Za-z0-9_\-]{24,}/g, "[REDACTED]");
  console.log(
    JSON.stringify({
      status: response.status,
      diagnostic: message.slice(0, 2000),
      keysDisplayed: false,
      paymentWrites: 0,
    }),
  );
}
main().catch(() => {
  console.error("GROQ_DIAGNOSTIC_UNAVAILABLE");
  process.exitCode = 1;
});
