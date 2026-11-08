import "dotenv/config";
async function main() {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    console.log("GEMINI_NOT_CONFIGURED");
    return;
  }
  for (const model of ["gemini-3.8-flash", "gemini-2.5-flash"]) {
    const started = Date.now();
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": key,
            "Content-Type": "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            contents: [
              { parts: [{ text: 'Return the JSON object {"ready":true}.' }] },
            ],
            generationConfig: {
              maxOutputTokens: 128,
              thinkingConfig:
                model === "gemini-2.5-flash"
                  ? { thinkingBudget: 0 }
                  : { thinkingLevel: "low" },
              responseMimeType: "application/json",
            },
          }),
        },
      );
      const raw = (await response.json()) as {
        responseId?: string;
        modelVersion?: string;
        error?: { status?: string };
      };
      console.log(
        JSON.stringify({
          model,
          status: response.status,
          generationAccepted: response.ok,
          providerError: raw.error?.status ?? null,
          durationMs: Date.now() - started,
          keysDisplayed: false,
          paymentWrites: 0,
        }),
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          model,
          generationAccepted: false,
          failure: error instanceof Error ? error.name : "UNKNOWN",
          networkCode:
            (error as { cause?: { code?: string } })?.cause?.code ?? null,
          keysDisplayed: false,
        }),
      );
    }
  }
}
main().catch(() => {
  console.error("GEMINI_CHECK_FAILED");
  process.exitCode = 1;
});
