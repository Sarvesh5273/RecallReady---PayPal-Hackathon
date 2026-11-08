import "dotenv/config";
import { geminiModel } from "../lib/adapters/gemini";
async function main() {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    console.log(JSON.stringify({ configured: false, keysDisplayed: false }));
    return;
  }
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models",
      {
        headers: { "x-goog-api-key": key },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      console.log(
        JSON.stringify({
          status: response.status,
          authenticated: false,
          keysDisplayed: false,
        }),
      );
      return;
    }
    const raw = (await response.json()) as {
      models?: { name: string; supportedGenerationMethods?: string[] }[];
    };
    console.log(
      JSON.stringify({
        status: response.status,
        authenticated: true,
        selectedModelAvailable: raw.models?.some(
          (m) => m.name === "models/" + geminiModel(),
        ),
        models: raw.models
          ?.filter((m) =>
            [
              "models/gemini-3.8-flash",
              "models/gemini-3.6-flash",
              "models/gemini-2.5-flash",
              "models/gemini-2.5-pro",
            ].includes(m.name),
          )
          .map((m) => ({
            name: m.name,
            generateContent:
              m.supportedGenerationMethods?.includes("generateContent"),
          })),
        keysDisplayed: false,
      }),
    );
  } catch (error) {
    const name = error instanceof Error ? error.name : "UNKNOWN";
    const code = (error as { cause?: { code?: string } })?.cause?.code;
    console.log(
      JSON.stringify({
        authenticated: false,
        failure: name,
        networkCode: code ?? null,
        keysDisplayed: false,
      }),
    );
  }
}
main().catch(() => {
  console.error("GEMINI_PREFLIGHT_FAILED");
  process.exitCode = 1;
});
