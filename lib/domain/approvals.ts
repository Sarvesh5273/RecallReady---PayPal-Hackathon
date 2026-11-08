import { createHash } from "node:crypto";
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map(canonicalize).join(",") + "]";
  if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonicalize((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  throw new Error("Non-canonical value");
}
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function fingerprint(value: unknown) {
  const canonical = canonicalize(value);
  return { canonical, hash: sha256(canonical) };
}
