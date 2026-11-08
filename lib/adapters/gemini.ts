import { z } from "zod";
import { candidateSchema, type EvidenceDocument } from "../domain/types";
import { BusinessError } from "../errors";
import {
  EXTRACTION_PROMPT,
  boundDocuments,
  validateExtraction,
  ExtractionValidationError,
} from "./extraction-contract";
const HOST = "https://generativelanguage.googleapis.com";
const MODELS = new Set([
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
]);
export function geminiModel() {
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite";
  if (!MODELS.has(model))
    throw new BusinessError(
      "GEMINI_MODEL_UNSUPPORTED",
      "Choose a supported Gemini structured-output model.",
      503,
    );
  return model;
}
export const GEMINI_RESPONSE_SCHEMA = z.toJSONSchema(candidateSchema, {
  target: "draft-2020-12",
});
delete GEMINI_RESPONSE_SCHEMA.$schema;
function constrainLiterals(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  if ("const" in node) {
    node.enum = [node.const];
    delete node.const;
  }
  Object.values(node).forEach((child) =>
    Array.isArray(child)
      ? child.forEach(constrainLiterals)
      : constrainLiterals(child),
  );
}
constrainLiterals(GEMINI_RESPONSE_SCHEMA);
const responseSchema = z.object({
  responseId: z.string().min(1),
  modelVersion: z.string().min(1),
  candidates: z
    .array(
      z.object({
        finishReason: z.string(),
        content: z.object({
          parts: z.array(
            z.object({
              text: z.string().optional(),
              thought: z.boolean().optional(),
            }),
          ),
        }),
      }),
    )
    .length(1),
});
async function boundedJSON(response: Response) {
  const reader = response.body?.getReader();
  if (!reader)
    throw new BusinessError(
      "AI_RESPONSE_INVALID",
      "Gemini returned an empty response.",
      503,
    );
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1048576) {
      await reader.cancel();
      throw new BusinessError(
        "AI_RESPONSE_INVALID",
        "Gemini response exceeds the body limit.",
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
      "Gemini returned malformed JSON.",
      503,
    );
  }
}
export async function extractGemini(documents: EvidenceDocument[]) {
  const content = boundDocuments(documents),
    model = geminiModel(),
    key = process.env.GEMINI_API_KEY?.trim();
  if (!key)
    throw new BusinessError(
      "GEMINI_NOT_CONFIGURED",
      "Configure GEMINI_API_KEY in the server environment.",
      503,
    );
  let response: Response;
  try {
    response = await fetch(`${HOST}/v1beta/models/${model}:generateContent`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(45000),
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text:
                EXTRACTION_PROMPT +
                ' Return every required field, retaining source wording exactly. schemaVersion must be the exact string "1", never "1.0". Serial prefixes or other serial restrictions mean CONSTRAINED, never ALL_EXPLICIT. For ALL_EXPLICIT include a source quote with the exact model and its all-serial statement together. Include enough context to make source quotes unique. Do not convert the caption PB003 into an alias.',
            },
          ],
        },
        contents: [
          { role: "user", parts: [{ text: JSON.stringify(content) }] },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 10000,
          thinkingConfig: model.startsWith("gemini-2.5")
            ? { thinkingBudget: 1024, includeThoughts: false }
            : { thinkingLevel: "low", includeThoughts: false },
          responseMimeType: "application/json",
          responseJsonSchema: GEMINI_RESPONSE_SCHEMA,
        },
      }),
    });
  } catch {
    throw new BusinessError(
      "GEMINI_UNAVAILABLE",
      "Gemini timed out or could not connect. No rule was approved.",
      503,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new BusinessError(
      response.status === 401 || response.status === 403
        ? "GEMINI_AUTH_FAILED"
        : response.status === 429
          ? "GEMINI_RATE_LIMITED"
          : "GEMINI_REQUEST_FAILED",
      `Gemini rejected extraction (HTTP ${response.status}). Check API access, model availability, and quota.`,
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
      "Gemini returned an incomplete or blocked response envelope.",
      503,
    );
  }
  const candidate = raw.candidates[0];
  if (candidate.finishReason !== "STOP")
    throw new BusinessError(
      "AI_NOT_COMPLETED",
      "Gemini extraction was incomplete or refused. No rule was approved.",
      422,
    );
  if (raw.modelVersion !== model && !raw.modelVersion.startsWith(model + "-"))
    throw new BusinessError(
      "AI_MODEL_MISMATCH",
      "Gemini returned a different model than requested.",
      503,
    );
  const text = candidate.content.parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
  let output: unknown;
  try {
    output = JSON.parse(text);
  } catch {
    throw new BusinessError(
      "AI_RESPONSE_INVALID",
      "Gemini returned invalid structured text.",
      503,
    );
  }
  let validated;
  try {
    validated = validateExtraction(output, documents);
  } catch (error) {
    if (error instanceof ExtractionValidationError) {
      error.model = raw.modelVersion;
      error.responseId = raw.responseId;
    }
    throw error;
  }
  return {
    candidate: validated,
    model: raw.modelVersion,
    responseId: raw.responseId,
  };
}
