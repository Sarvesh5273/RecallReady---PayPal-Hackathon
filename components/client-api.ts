export async function api<T>(path: string, body?: unknown): Promise<T> {
  const csrf =
    typeof document === "undefined"
      ? ""
      : (document.cookie
          .split("; ")
          .find((x) => x.startsWith("rr_csrf="))
          ?.split("=")[1] ?? "");
  const response = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "x-csrf-token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "Request failed");
  return result as T;
}
