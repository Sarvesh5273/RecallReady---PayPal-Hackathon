import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { candidateSchema, type EvidenceDocument } from "../domain/types";
import { BusinessError } from "../errors";
import {
  EXTRACTION_PROMPT,
  boundDocuments,
  validateExtraction,
} from "./extraction-contract";
export async function extractSource(documents: EvidenceDocument[]) {
  if (!process.env.OPENAI_API_KEY)
    throw new BusinessError(
      "OPENAI_NOT_CONFIGURED",
      "OpenAI extraction is unavailable. Configure the server key.",
      503,
    );
  const content = boundDocuments(documents);
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 30000,
    maxRetries: 0,
  });
  const response = await client.responses.parse({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    input: [
      { role: "system", content: EXTRACTION_PROMPT },
      {
        role: "user",
        content: JSON.stringify(content),
      },
    ],
    text: { format: zodTextFormat(candidateSchema, "recall_candidate_v1") },
    max_output_tokens: 6000,
    store: false,
  });
  if (response.status !== "completed" || !response.output_parsed)
    throw new Error("EXTRACTION_NOT_COMPLETED");
  const candidate = validateExtraction(response.output_parsed, documents);
  return { candidate, model: response.model, responseId: response.id };
}
