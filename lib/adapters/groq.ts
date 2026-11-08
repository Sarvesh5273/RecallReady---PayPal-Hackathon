import { z } from "zod";
import { candidateSchema, type EvidenceDocument } from "../domain/types";
import { BusinessError } from "../errors";
import {
  EXTRACTION_PROMPT,
  boundDocuments,
  validateExtraction,
  GROQ_EXTRACTION_GUIDANCE,
} from "./extraction-contract";
const BASE = "https://api.groq.com/openai/v1";
const STRICT_MODELS = new Set([
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
  "meta-models/muse-spark-open",
]);
export function groqModel() {
  const model = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
  if (!STRICT_MODELS.has(model))
    throw new BusinessError(
      "GROQ_MODEL_UNSUPPORTED",
      "Select a Groq model supporting strict structured outputs; default is openai/gpt-oss-120b.",
      503,
    );
  return model;
}
export const GROQ_RESPONSE_SCHEMA = z.toJSONSchema(candidateSchema, {
  target: "draft-7",
});
delete GROQ_RESPONSE_SCHEMA.$schema;
// Use the provider's supported structural subset. Non-empty strings and other
// semantic constraints remain mandatory in the unchanged server-side Zod schema.
function groqSchemaSubset(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  delete node.minLength;
  if ("const" in node) {
    node.enum = [node.const];
    delete node.const;
  }
  for (const child of Object.values(node))
    if (Array.isArray(child)) child.forEach(groqSchemaSubset);
    else groqSchemaSubset(child);
}
groqSchemaSubset(GROQ_RESPONSE_SCHEMA);
async function boundedJSON(response: Response) {
  const reader = response.body?.getReader();
  if (!reader)
    throw new BusinessError(
      "AI_RESPONSE_INVALID",
      "Groq returned an empty response.",
      503,
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1048576) {
      await reader.cancel();
      throw new BusinessError(
        "AI_RESPONSE_INVALID",
        "Groq response exceeds the body limit.",
        503,
      );
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new BusinessError(
      "AI_RESPONSE_INVALID",
      "Groq returned an invalid response.",
      503,
    );
  }
}
const responseSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  choices: z
    .array(
      z.object({
        finish_reason: z.string(),
        message: z.object({
          content: z.string().nullable(),
          refusal: z.string().nullable().optional(),
        }),
      }),
    )
    .length(1),
});
export async function extractGroq(documents: EvidenceDocument[]) {
  const content = boundDocuments(documents),
    model = groqModel(),
    key = process.env.GROQ_API_KEY?.trim();
  if (!key)
    throw new BusinessError(
      "GROQ_NOT_CONFIGURED",
      "Configure GROQ_API_KEY in the server environment.",
      503,
    );
  let response: Response;
  try {
    response = await fetch(BASE + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: EXTRACTION_PROMPT + " " + GROQ_EXTRACTION_GUIDANCE,
          },
          { role: "user", content: JSON.stringify(content) },
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
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
  } catch {
    throw new BusinessError(
      "GROQ_UNAVAILABLE",
      "Groq request timed out or could not connect. No rule was approved.",
      503,
    );
  }
  if (!response.ok) {
    let category = "REQUEST";
    try {
      const payload = (await boundedJSON(response)) as {
        error?: { message?: string; code?: string; type?: string };
      };
      // Examine provider errors only inside the server; emit fixed classifications, never raw messages.
      const message = payload.error?.message?.toLowerCase() ?? "";
      if (/schema|json_schema|minlength|additionalproperties/.test(message))
        category = "SCHEMA";
      else if (
        /tokens|token limit|request too large|maximum context/.test(message)
      )
        category = "INPUT_LIMIT";
      else if (
        /model.*(not found|not exist|unsupported|permission)/.test(message)
      )
        category = "MODEL";
    } catch {
      category = "REQUEST";
    }
    throw new BusinessError(
      response.status === 401 || response.status === 403
        ? "GROQ_AUTH_FAILED"
        : response.status === 429
          ? "GROQ_RATE_LIMITED"
          : `GROQ_${category}_FAILED`,
      `Groq rejected the extraction (HTTP ${response.status}; ${category.toLowerCase()}). No rule was approved.`,
      response.status === 429 ? 429 : 503,
    );
  }
  let raw: z.infer<typeof responseSchema>;
  try {
    raw = responseSchema.parse(await boundedJSON(response));
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    throw new BusinessError(
      "AI_RESPONSE_INVALID",
      "Groq returned an invalid completion envelope.",
      503,
    );
  }
  const choice = raw.choices[0];
  if (
    choice.finish_reason !== "stop" ||
    !choice.message.content ||
    choice.message.refusal
  )
    throw new BusinessError(
      "AI_NOT_COMPLETED",
      "Groq extraction was incomplete or refused. No rule was approved.",
      422,
    );
  if (raw.model !== model)
    throw new BusinessError(
      "AI_MODEL_MISMATCH",
      "Groq returned a different model than requested.",
      503,
    );
  let candidate: unknown;
  try {
    candidate = JSON.parse(choice.message.content);
  } catch {
    throw new BusinessError(
      "AI_RESPONSE_INVALID",
      "Groq returned invalid structured text.",
      503,
    );
  }
  const candidateParsed = validateExtraction(candidate, documents);
  return {
    candidate: candidateParsed,
    model: raw.model,
    responseId: raw.id,
  };
}
