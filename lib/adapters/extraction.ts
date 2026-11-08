import type { EvidenceDocument } from "../domain/types";
import { BusinessError } from "../errors";
import { extractSource as extractOpenAI } from "./openai";
import { extractGroq, groqModel } from "./groq";
import { extractGemini, geminiModel } from "./gemini";
export type AIProvider = "GROQ" | "OPENAI" | "GEMINI";
export function extractionConfig() {
  const selected =
    process.env.AI_PROVIDER?.trim().toUpperCase() ||
    (process.env.GEMINI_API_KEY?.trim() ? "GEMINI" : "GROQ");
  if (selected !== "GROQ" && selected !== "OPENAI" && selected !== "GEMINI")
    throw new BusinessError(
      "AI_PROVIDER_INVALID",
      "Set AI_PROVIDER to gemini, groq, or openai.",
      503,
    );
  const provider: AIProvider = selected;
  return {
    provider,
    model:
      provider === "GEMINI"
        ? geminiModel()
        : provider === "GROQ"
          ? groqModel()
          : (process.env.OPENAI_MODEL ?? "gpt-4.1-mini"),
    configured: Boolean(
      (provider === "GEMINI"
        ? process.env.GEMINI_API_KEY
        : provider === "GROQ"
          ? process.env.GROQ_API_KEY
          : process.env.OPENAI_API_KEY
      )?.trim(),
    ),
  };
}
export function extractionReadiness() {
  try {
    return extractionConfig();
  } catch {
    return { provider: "UNAVAILABLE", model: null, configured: false };
  }
}
export async function extractSource(documents: EvidenceDocument[]) {
  const config = extractionConfig();
  if (!config.configured)
    throw new BusinessError(
      "AI_NOT_CONFIGURED",
      `Configure the ${config.provider} server key.`,
      503,
    );
  // An unavailable provider never falls back to fixtures or a different service.
  const result =
    config.provider === "GEMINI"
      ? await extractGemini(documents)
      : config.provider === "GROQ"
        ? await extractGroq(documents)
        : await extractOpenAI(documents);
  return { ...result, provider: config.provider };
}
